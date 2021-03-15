import { IActionContext, SubscriptionTreeItemBase, AzExtTreeItem, AzExtParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { listAll, toSubscription } from '../azure-api-utils';
import AksClusterTreeItem from './aksClusterTreeItem';
import { SubscriptionModels } from '@azure/arm-subscriptions';
import { ResourceManagementClient } from '@azure/arm-resources';

// The de facto API of tree nodes that represent individual Azure subscriptions.
// Tree items should implement this interface to maintain backward compatibility with previous versions of the extension.
export interface SubscriptionTreeNode {
    readonly nodeType: 'subscription';
    readonly name: string;
    readonly session: ISubscriptionContext;
    readonly subscription: SubscriptionModels.Subscription;
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
        const client = new ResourceManagementClient(this.root.credentials, this.root.subscriptionId);
        const aksClusterResources = await listAll(client.resources, client.resources.list({ filter: "resourceType eq 'Microsoft.ContainerService/managedClusters'" }));

        return aksClusterResources.map((aksClusterResource) => new AksClusterTreeItem(this, aksClusterResource));
    }

    public get name(): string {
        return this.root.subscriptionDisplayName || '';
    }

    public get session(): ISubscriptionContext {
        return this.root;
    }

    public get subscription(): SubscriptionModels.Subscription {
        return toSubscription(this.root);
    }

    public readonly nodeType = 'subscription';
}