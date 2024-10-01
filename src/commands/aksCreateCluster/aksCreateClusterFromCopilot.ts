import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../utils/errorable";
import { getSubscriptions, handleNoSubscriptionsFound, SelectionType, SubscriptionQuickPickItem } from "../utils/subscriptions";
import { window } from "vscode";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function aksCreateClusterFromCopilot(_context: IActionContext): Promise<void> {
    const subscriptionId = await selectSubscription();

    if (!subscriptionId) {
        vscode.window.showErrorMessage("A Subscription Id is required to create an AKS cluster.");
        return;
    }

    vscode.commands.executeCommand("aks.createCluster", subscriptionId);
}

export async function selectSubscription(): Promise<string | undefined> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const allSubscriptions = await getSubscriptions(sessionProvider.result, SelectionType.All);
    if (failed(allSubscriptions)) {
        await window.showErrorMessage(allSubscriptions.error);
        return;
    }

    if (allSubscriptions.result.length === 0) {
        await handleNoSubscriptionsFound();
        return;
    }

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            subscription: {
                subscriptionId: sub.subscriptionId || "",
                tenantId: sub.tenantId || "",
            },
        };
    });

    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select a Subscription",
    });

    if(!selectedItem) {
        return undefined;
    }

    return selectedItem.subscription.subscriptionId;
}
