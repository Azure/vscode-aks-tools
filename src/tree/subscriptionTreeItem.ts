import {
    AzExtParentTreeItem,
    AzExtTreeDataProvider,
    AzExtTreeItem,
    ISubscriptionContext,
} from "@microsoft/vscode-azext-utils";
import { createClusterTreeNode } from "./aksClusterTreeItem";
import { assetUri } from "../assets";
import * as k8s from "vscode-kubernetes-tools-api";
import { Resource } from "@azure/arm-resources";
import { getResourceManagementClient } from "../commands/utils/arm";

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: "subscription";
    readonly name: string;
    readonly subscription: ISubscriptionContext;
    readonly treeDataProvider: AzExtTreeDataProvider;
    readonly treeItem: AzExtTreeItem;
}

export function isSubscriptionTreeNode(node: unknown): node is SubscriptionTreeNode {
    return node instanceof SubscriptionTreeItem;
}

export function createSubscriptionTreeItem(
    parent: AzExtParentTreeItem,
    subscription: ISubscriptionContext,
): AzExtTreeItem {
    return new SubscriptionTreeItem(parent, subscription);
}

class SubscriptionTreeItem extends AzExtParentTreeItem implements SubscriptionTreeNode {
    public readonly subscriptionValue: ISubscriptionContext;
    public readonly name: string;
    public readonly contextValue = "aks.subscription";
    public readonly label: string;

    public constructor(parent: AzExtParentTreeItem, subscription: ISubscriptionContext) {
        super(parent);
        this.subscriptionValue = subscription;
        this.name = subscription.subscriptionDisplayName;
        this.label = subscription.subscriptionDisplayName;
        this.id = subscription.subscriptionPath;
        this.iconPath = assetUri("resources/azureSubscription.svg");
    }

    get treeItem(): AzExtTreeItem {
        return this;
    }

    get subscription(): ISubscriptionContext {
        return this.subscriptionValue;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        const client = getResourceManagementClient(this.subscription.subscriptionId);
        const aksClusterResources: Resource[] = [];
        const result = client.resources.list({
            filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'",
        });
        for await (const pageResources of result.byPage()) {
            aksClusterResources.push(...pageResources);
        }

        return aksClusterResources.map((aksClusterResource) => createClusterTreeNode(this, aksClusterResource));
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
