import { SubscriptionTreeItemBase } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, AzExtTreeItem, AzExtParentTreeItem, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import AksClusterTreeItem from './aksClusterTreeItem';
import { Subscription } from '@azure/arm-subscriptions';
import { getResourceManagementClient } from '../commands/utils/clusters';

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: 'subscription';
    readonly name: string;
    readonly session: ISubscriptionContext;
    readonly subscription: Subscription;
}

export default class SubscriptionTreeItem extends SubscriptionTreeItemBase implements SubscriptionTreeNode {
    constructor(
        parent: AzExtParentTreeItem,
        root: ISubscriptionContext) {
        super(parent, root);
    }

    public readonly contextValue: string = 'aks.subscription';

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        const client = getResourceManagementClient(this);
        const aksClusterResources = [];
        const result = client.resources.list({ filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'" });
        for await (const pageResources of result.byPage()) {
            aksClusterResources.push(...pageResources);
        }

        return aksClusterResources.map((aksClusterResource) => new AksClusterTreeItem(this, aksClusterResource));
    }

    public get name(): string {
        return this.subscription.subscriptionDisplayName || '';
    }

    public get session(): ISubscriptionContext {
        return this.session;
    }

    public readonly nodeType = 'subscription';
}