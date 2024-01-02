import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AzureAccountTreeItemBase, SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import { createChildSubscriptionTreeItem } from "./subscriptionTreeItem";
import * as k8s from "vscode-kubernetes-tools-api";

export function createAzureAccountTreeItem(): AzureAccountTreeItemBase {
    return new AzureAccountTreeItem();
}

class AzureAccountTreeItem extends AzureAccountTreeItemBase {
    public createSubscriptionTreeItem(subscription: ISubscriptionContext): SubscriptionTreeItemBase {
        return createChildSubscriptionTreeItem(this, subscription);
    }

    public async refreshImpl?(): Promise<void> {
        // NOTE: Updates to the subscription filter would normally refresh this node. However,
        //       the Cloud Explorer wraps this node with its own and doesn't listen for change
        //       events. Hence, we must force Cloud Explorer to refresh, which will then re-
        //       enumerate this node's children.
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;

        if (cloudExplorer.available) {
            cloudExplorer.api.refresh();
        }
    }
}
