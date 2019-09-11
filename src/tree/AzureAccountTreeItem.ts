import * as vscode from 'vscode';
import { AzureAccountTreeItemBase, ISubscriptionContext, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { SubscriptionTreeItem } from './SubscriptionTreeItem';

export class AzureAccountTreeItem extends AzureAccountTreeItemBase {
    constructor() {
        super();
    }

    public createSubscriptionTreeItem(root: ISubscriptionContext): SubscriptionTreeItemBase {
        return new SubscriptionTreeItem(this, root);
    }

    public refreshImpl?(): Promise<void> {
        vscode.commands.executeCommand('extension.vsKubernetesRefreshCloudExplorer');

        return Promise.resolve();
    }
}