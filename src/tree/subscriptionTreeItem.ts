import {
    AzExtParentTreeItem,
    AzExtTreeDataProvider,
    AzExtTreeItem,
    ISubscriptionContext,
} from "@microsoft/vscode-azext-utils";
import { createClusterTreeNode } from "./aksClusterTreeItem";
import { assetUri } from "../assets";
import * as k8s from "vscode-kubernetes-tools-api";
import { window } from "vscode";
import { getResources } from "../commands/utils/azureResources";
import { failed } from "../commands/utils/errorable";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getFilteredClusters } from "../commands/utils/config";

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: "subscription";
    readonly name: string;
    readonly subscriptionId: string;
    readonly treeDataProvider: AzExtTreeDataProvider;
    readonly treeItem: AzExtTreeItem;
}

export function isSubscriptionTreeNode(node: unknown): node is SubscriptionTreeNode {
    return node instanceof SubscriptionTreeItem;
}

export function createSubscriptionTreeItem(
    parent: AzExtParentTreeItem,
    sessionProvider: ReadyAzureSessionProvider,
    subscription: ISubscriptionContext,
): AzExtTreeItem {
    return new SubscriptionTreeItem(parent, sessionProvider, subscription);
}

class SubscriptionTreeItem extends AzExtParentTreeItem implements SubscriptionTreeNode {
    private readonly sessionProvider: ReadyAzureSessionProvider;
    public readonly subscriptionContext: ISubscriptionContext;
    public readonly subscriptionId: string;
    public readonly name: string;
    public readonly contextValue = "aks.subscription";
    public readonly label: string;

    public constructor(
        parent: AzExtParentTreeItem,
        sessionProvider: ReadyAzureSessionProvider,
        subscription: ISubscriptionContext,
    ) {
        super(parent);
        this.sessionProvider = sessionProvider;
        this.subscriptionContext = subscription;
        this.subscriptionId = subscription.subscriptionId;
        this.name = subscription.subscriptionDisplayName;
        this.label = subscription.subscriptionDisplayName;
        this.id = subscription.subscriptionPath;
        this.iconPath = assetUri("resources/azureSubscription.svg");
    }

    get treeItem(): AzExtTreeItem {
        return this;
    }

    /**
     * Needed by parent class.
     */
    get subscription(): ISubscriptionContext {
        return this.subscriptionContext;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        const clusterResources = await getResources(
            this.sessionProvider,
            this.subscription.subscriptionId,
            "Microsoft.ContainerService/managedClusters",
        );
        if (failed(clusterResources)) {
            window.showErrorMessage(
                `Failed to list clusters in subscription ${this.subscription.subscriptionId}: ${clusterResources.error}`,
            );
            return [];
        }

        const getClusterFilter = getFilteredClusters();
        return clusterResources.result
            .map((r) => {
                // Check if the subscription is in the filter for SeelctedClustersFilter
                const isSubIdExistInClusterFilter = getClusterFilter.some(
                    (filter) => filter.subscriptionId === this.subscriptionId,
                );

                // Ensure getClusterFilter is an array of objects with name and subid properties
                if (isSubIdExistInClusterFilter) {
                    // Check if there's a match for the cluster name and subid
                    const matchedCluster = getClusterFilter.find(
                        (filter) => filter.clusterName === r.name && filter.subscriptionId === this.subscriptionId,
                    );

                    if (matchedCluster) {
                        return createClusterTreeNode(this, this.subscriptionId, r);
                    }
                } else {
                    return createClusterTreeNode(this, this.subscriptionId, r);
                }
                return undefined;
            })
            .filter((node) => node !== undefined) as AzExtTreeItem[];
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
