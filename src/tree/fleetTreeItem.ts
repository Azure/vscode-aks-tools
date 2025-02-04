import { AzExtParentTreeItem, AzExtTreeItem, IActionContext } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { DefinedFleetMemberWithGroup, DefinedResourceWithGroup } from "../commands/utils/azureResources";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";
import { createClusterTreeNode } from "./aksClusterTreeItem";
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
    readonly fleetResource: DefinedResourceWithGroup;
    addCluster(clusters: DefinedResourceWithGroup[]): void;
}

export function createFleetTreeNode(
    parent: AzExtParentTreeItem & SubscriptionTreeNode,
    subscriptionId: string,
    fleetResource: DefinedResourceWithGroup,
): FleetTreeItem {
    return new FleetTreeItem(parent, subscriptionId, fleetResource);
}

class FleetTreeItem extends AzExtParentTreeItem implements FleetTreeNode {
    public readonly subscriptionTreeNode: SubscriptionTreeNode;
    public readonly armId: string;
    public readonly resourceGroupName: string;
    public readonly name: string;

    constructor(
        parent: AzExtParentTreeItem & SubscriptionTreeNode,
        readonly subscriptionId: string,
        readonly fleetResource: DefinedResourceWithGroup,
    ) {
        super(parent);

        this.iconPath = assetUri("resources/fleet-tree-icon.png");
        this.subscriptionTreeNode = parent;
        this.id = `${this.fleetResource.name} ${fleetResource.resourceGroup}`;
        this.armId = this.fleetResource.id;
        this.resourceGroupName = fleetResource.resourceGroup;
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

    private readonly clusters: Map<string, DefinedFleetMemberWithGroup> = new Map<
        string,
        DefinedFleetMemberWithGroup
    >();

    public addCluster(clusters: DefinedFleetMemberWithGroup[]): void {
        clusters.forEach((c) => {
            this.clusters.set(c.id, c);
        });
    }
    /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
    public loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        const treeItems: AzExtTreeItem[] = [];
        this.clusters.forEach((c) => {
            const parsedResourceId = parseResource(c.clusterResourceId);
            const drg: DefinedResourceWithGroup = {
                // the cluster resource parsed from the member resource
                id: c.id,
                name: parsedResourceId.name!,
                resourceGroup: parsedResourceId.resourceGroupName!,
            };
            treeItems.push(createClusterTreeNode(this, this.subscriptionId, drg));
        });
        console.log(_clearCache, _context); // to delete
        return Promise.resolve(treeItems);
    }
    public hasMoreChildrenImpl(): boolean {
        return false; // we pre-load the clusters in the TreeItem. no need to load more.
    }
}
