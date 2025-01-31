import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { DefinedResourceWithGroup, getFleetMembers } from "../commands/utils/azureResources";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";
import { createClusterTreeNode } from "./aksClusterTreeItem";
import { ReadyAzureSessionProvider } from "../auth/types";
import { failed } from "../commands/utils/errorable";
import { window } from "vscode";
import { parseResource } from "../azure-api-utils";

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface FleetTreeNode {
    readonly nodeType: "fleet";
    readonly resourceType: string;
    readonly armId: string;
    readonly name: string;
    readonly subscriptionTreeNode: SubscriptionTreeNode;
    readonly subscriptionId: string;
    readonly resourceGroupName: string;
}

export function createFleetTreeNode(
    parent: AzExtParentTreeItem & SubscriptionTreeNode,
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    fleetResource: DefinedResourceWithGroup,
): FleetTreeItem {
    return new FleetTreeItem(parent, sessionProvider, subscriptionId, fleetResource);
}

class FleetTreeItem extends AzExtParentTreeItem implements FleetTreeNode {
    private readonly sessionProvider: ReadyAzureSessionProvider;
    public readonly subscriptionTreeNode: SubscriptionTreeNode;
    public readonly armId: string;
    public readonly resourceGroupName: string;
    public readonly name: string;
    private readonly fleetResource: DefinedResourceWithGroup;

    constructor(
        parent: AzExtParentTreeItem & SubscriptionTreeNode,
        sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly fleet: DefinedResourceWithGroup,
    ) {
        super(parent);
        this.sessionProvider = sessionProvider;
        this.iconPath = assetUri("resources/fleet-tree-icon.png");
        this.subscriptionTreeNode = parent;
        this.fleetResource = fleet;
        this.id = `${this.fleetResource.name} ${this.fleetResource.resourceGroup}`;
        this.armId = this.fleetResource.id;
        this.resourceGroupName = this.fleetResource.resourceGroup;
        this.name = this.fleetResource.name;
    }

    public readonly contextValue: string = `fleet.hub ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.name;
    }

    public get resourceType(): string {
        return "Microsoft.ContainerService/fleets";
    }

    public get clusterTreeItem(): AzExtTreeItem {
        return this;
    }

    public readonly nodeType = "fleet";

    /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        const members = await getFleetMembers(this.sessionProvider, this.fleetResource);
        if (failed(members)) {
            window.showErrorMessage(
                `Failed to list fleets in subscription ${this.subscription.subscriptionId}: ${members.error}`,
            );
            return [];
        }
        return members.result.map((m) => {
            const parsedResourceId = parseResource(m.clusterResourceId);

            const drg: DefinedResourceWithGroup = {
                id: m.clusterResourceId,
                name: parsedResourceId.name!,
                resourceGroup: parsedResourceId.resourceGroupName!,
            };
            return createClusterTreeNode(this, this.subscriptionId, drg);
        });
    }

    public hasMoreChildrenImpl(): boolean {
        return false; // we load all members in a single list call.
    }
}
