import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { CreateClusterDataProvider, CreateClusterPanel } from "../../panels/CreateClusterPanel";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { Errorable, failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { getSubscription } from "../utils/subscriptions";
import { SubscriptionTreeNode } from "../../tree/subscriptionTreeItem";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 *
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(_context: IActionContext, target: unknown): Promise<void> {
    let subscriptionNode: Errorable<SubscriptionTreeNode>;
    let subscriptionId: string | undefined;
    let subscriptionName: string | undefined;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    switch (typeof target) {
        case "string": {
            const subscriptionResult = await getSubscription(sessionProvider.result, target);
            if (failed(subscriptionResult)) {
                vscode.window.showErrorMessage(subscriptionResult.error);
                return;
            }
            subscriptionId = subscriptionResult.result?.subscriptionId;
            subscriptionName = subscriptionResult.result?.displayName;
            break;
        }

        default: {
            subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
            if (failed(subscriptionNode)) {
                vscode.window.showErrorMessage(subscriptionNode.error);
                return;
            }
            if (!subscriptionNode.result || !subscriptionNode.result.subscriptionId || !subscriptionNode.result.name) {
                vscode.window.showErrorMessage("Subscription not found.");
                return;
            }
            subscriptionId = subscriptionNode.result?.subscriptionId;
            subscriptionName = subscriptionNode.result?.name;
            break;
        }

    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const panel = new CreateClusterPanel(extension.result.extensionUri);

    if (!subscriptionId || !subscriptionName) {
        vscode.window.showErrorMessage("Subscription ID or Name is undefined.");
        return;
    }

    const dataProvider = new CreateClusterDataProvider(sessionProvider.result, subscriptionId, subscriptionName, () =>
        vscode.commands.executeCommand("aks.refreshSubscription", target),
    );

    panel.show(dataProvider);
}
