import { AzExtParentTreeItem, AzExtTreeItem, ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { CloudExplorerV1 } from "vscode-kubernetes-tools-api";
import { assetUri } from "../assets";
import { parseResource } from "../azure-api-utils";
import { Resource } from "@azure/arm-resources";
import { SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import { SubscriptionTreeNode } from "./subscriptionTreeItem";

// The de facto API of tree nodes that represent individual AKS clusters.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface AksClusterTreeNode {
    readonly nodeType: "cluster";
    readonly resourceType: string;
    readonly armId: string;
    readonly name: string;
    readonly subscriptionTreeNode: SubscriptionTreeNode;
    readonly subscription: ISubscriptionContext;
    readonly resourceGroupName: string;
}

export function createChildClusterTreeNode(
    parent: SubscriptionTreeItemBase & SubscriptionTreeNode,
    clusterResource: Resource,
): AzExtTreeItem {
    return new AksClusterTreeItem(parent, clusterResource);
}

class AksClusterTreeItem extends AzExtTreeItem implements AksClusterTreeNode {
    public readonly armId: string;
    public readonly subscriptionTreeNode: SubscriptionTreeNode;
    constructor(
        parent: AzExtParentTreeItem & SubscriptionTreeNode,
        readonly resource: Resource,
    ) {
        super(parent);

        this.iconPath = assetUri("resources/aks-tools.png");
        this.id = `${this.resource.name!} ${parseResource(this.resource.id!).resourceGroupName!}`;
        this.armId = this.resource.id!;
        this.subscriptionTreeNode = parent;
    }

    public readonly contextValue: string = `aks.cluster ${CloudExplorerV1.SHOW_KUBECONFIG_COMMANDS_CONTEXT}`;

    public get label(): string {
        return this.name;
    }

    public get name(): string {
        return this.resource.name!;
    }

    public get resourceType(): string {
        return this.resource.type!;
    }

    public get resourceGroupName(): string {
        // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
        return parseResource(this.armId).resourceGroupName!;
    }

    public get clusterTreeItem(): AzExtTreeItem {
        return this;
    }

    public readonly nodeType = "cluster";
}
