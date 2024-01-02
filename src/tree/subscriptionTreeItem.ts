import { AzureAccountTreeItemBase, SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import {
    AzExtTreeItem,
    AzExtParentTreeItem,
    ISubscriptionContext,
    AzExtTreeDataProvider,
} from "@microsoft/vscode-azext-utils";
import { createChildClusterTreeNode } from "./aksClusterTreeItem";
import { getResourceManagementClient } from "../commands/utils/clusters";
import * as k8s from "vscode-kubernetes-tools-api";
import { Resource } from "@azure/arm-resources";

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: "subscription";
    readonly name: string;
    readonly subscription: ISubscriptionContext;
    readonly treeDataProvider: AzExtTreeDataProvider;
    readonly treeItem: AzExtTreeItem;
}

export function createChildSubscriptionTreeItem(
    parent: AzureAccountTreeItemBase,
    subscription: ISubscriptionContext,
): SubscriptionTreeItemBase {
    return new SubscriptionTreeItem(parent, subscription);
}

class SubscriptionTreeItem extends SubscriptionTreeItemBase implements SubscriptionTreeNode {
    public readonly name: string;

    constructor(parent: AzExtParentTreeItem, root: ISubscriptionContext) {
        super(parent, root);
        this.name = root.subscriptionDisplayName || "";
    }

    get treeItem(): AzExtTreeItem {
        return this;
    }

    public readonly contextValue: string = "aks.subscription";

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        const client = getResourceManagementClient(this);
        const aksClusterResources: Resource[] = [];
        const result = client.resources.list({
            filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'",
        });
        for await (const pageResources of result.byPage()) {
            aksClusterResources.push(...pageResources);
        }

        return aksClusterResources.map((aksClusterResource) => createChildClusterTreeNode(this, aksClusterResource));
    }

    public async refreshImpl(): Promise<void> {
        // NOTE: Cloud Explorer wraps this node with its own and doesn't listen for change events.
        //       Hence, we must force Cloud Explorer to refresh in addition to reloading this node.
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;
        if (cloudExplorer.available) {
            cloudExplorer.api.refresh();
        }
    }

    public readonly nodeType = "subscription";
}
