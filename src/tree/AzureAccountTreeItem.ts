import * as vscode from 'vscode';
import { AzureAccountTreeItemBase, ISubscriptionContext, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import SubscriptionTreeItem from './SubscriptionTreeItem';

export default class AzureAccountTreeItem extends AzureAccountTreeItemBase {
    public createSubscriptionTreeItem(root: ISubscriptionContext): SubscriptionTreeItemBase {
        return new SubscriptionTreeItem(this, root);
    }

    public refreshImpl?(): Promise<void> {
        // NOTE: Updates to the subscription filter would normally refresh this node. However,
        //       the Cloud Explorer wraps this node with its own and doesn't listen for change
        //       events. Hence, we must force Cloud Explorer to refresh, which will then re-
        //       enumerate this node's children.
        vscode.commands.executeCommand('extension.vsKubernetesRefreshCloudExplorer');

        return Promise.resolve();
    }
}