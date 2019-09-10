import { AzureAccountTreeItemBase, ISubscriptionContext, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

export class AzureAccountTreeItem extends AzureAccountTreeItemBase {
    constructor() {
        super();
    }

    public createSubscriptionTreeItem(root: ISubscriptionContext): SubscriptionTreeItemBase {
        return new SubscriptionTreeItem(this, root);
    }
}