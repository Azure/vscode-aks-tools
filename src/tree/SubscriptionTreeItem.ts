import { IActionContext, SubscriptionTreeItemBase, AzExtTreeItem, IAzureUserInput, AzExtParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import ResourceManagementClient from 'azure-arm-resource/lib/resource/resourceManagementClient';
import { listAll } from '../azure-api-utils';
import AksClusterTreeItem from './AksClusterTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
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
}