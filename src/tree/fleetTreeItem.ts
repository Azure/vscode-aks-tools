import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { DefinedResourceWithGroup } from "../commands/utils/azureResources";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";

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
}

export function createFleetTreeNode(
    parent: AzExtParentTreeItem & SubscriptionTreeNode,
    subscriptionId: string,
    fleetResource: DefinedResourceWithGroup,
): AzExtTreeItem {
    return new FleetTreeItem(parent, subscriptionId, fleetResource);
}

class FleetTreeItem extends AzExtTreeItem implements FleetTreeNode {
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
}
