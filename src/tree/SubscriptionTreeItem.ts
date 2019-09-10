import { IActionContext, SubscriptionTreeItemBase, AzExtTreeItem, IAzureUserInput, AzExtParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    constructor(
        parent: AzExtParentTreeItem,
        root: ISubscriptionContext) {
        super(parent, root);
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        return [];
    }
}