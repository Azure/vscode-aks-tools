import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { DefinedResourceWithGroup } from "../commands/utils/azureResources";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface AksClusterTreeNode {
    readonly nodeType: "cluster";
    readonly resourceType: string;
    readonly armId: string;
    readonly name: string;
    readonly subscriptionTreeNode: SubscriptionTreeNode;
    readonly subscriptionId: string;
    readonly resourceGroupName: string;
}

export function createClusterTreeNode(
    parent: AzExtParentTreeItem & SubscriptionTreeNode,
    subscriptionId: string,
    clusterResource: DefinedResourceWithGroup,
): AzExtTreeItem {
    return new AksClusterTreeItem(parent, subscriptionId, clusterResource);
}

class AksClusterTreeItem extends AzExtTreeItem implements AksClusterTreeNode {
    public readonly subscriptionTreeNode: SubscriptionTreeNode;
    public readonly armId: string;
    public readonly resourceGroupName: string;
    public readonly name: string;

    constructor(
        parent: AzExtParentTreeItem & SubscriptionTreeNode,
        readonly subscriptionId: string,
        readonly clusterResource: DefinedResourceWithGroup,
    ) {
        super(parent);

        this.iconPath = assetUri("resources/aks-tools.png");
        this.subscriptionTreeNode = parent;
        this.id = `${this.clusterResource.name} ${clusterResource.resourceGroup}`;
        this.armId = this.clusterResource.id;
        this.resourceGroupName = clusterResource.resourceGroup;
        this.name = this.clusterResource.name;
    }

    public readonly contextValue: string = `aks.cluster ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.name;
    }

    public get resourceType(): string {
        return "Microsoft.ContainerService/managedClusters";
    }

    public get clusterTreeItem(): AzExtTreeItem {
        return this;
    }

    public readonly nodeType = "cluster";
}
