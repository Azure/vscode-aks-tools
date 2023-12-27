import { SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import {
    AzExtTreeItem,
    AzExtParentTreeItem,
    ISubscriptionContext,
    AzExtTreeDataProvider,
} from "@microsoft/vscode-azext-utils";
import AksClusterTreeItem from "./aksClusterTreeItem";
import { Subscription } from "@azure/arm-subscriptions";
import { getResourceManagementClient } from "../commands/utils/clusters";
import * as k8s from "vscode-kubernetes-tools-api";

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: "subscription";
    readonly name: string;
    readonly session: ISubscriptionContext;
    readonly subscription: Subscription;
    readonly treeDataProvider: AzExtTreeDataProvider;
    readonly treeItem: AzExtTreeItem;
}

export default class SubscriptionTreeItem extends SubscriptionTreeItemBase implements SubscriptionTreeNode {
    constructor(parent: AzExtParentTreeItem, root: ISubscriptionContext) {
        super(parent, root);
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
        const aksClusterResources = [];
        const result = client.resources.list({
            filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'",
        });
        for await (const pageResources of result.byPage()) {
            aksClusterResources.push(...pageResources);
        }

        return aksClusterResources.map((aksClusterResource) => new AksClusterTreeItem(this, aksClusterResource));
    }

    public async refreshImpl(): Promise<void> {
        // NOTE: Cloud Explorer wraps this node with its own and doesn't listen for change events.
        //       Hence, we must force Cloud Explorer to refresh in addition to reloading this node.
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;
        if (cloudExplorer.available) {
            cloudExplorer.api.refresh();
        }
    }

    public get name(): string {
        return this.subscription.subscriptionDisplayName || "";
    }

    public get session(): ISubscriptionContext {
        return this.session;
    }

    public readonly nodeType = "subscription";
}
