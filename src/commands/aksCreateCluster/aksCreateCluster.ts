import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { CreateClusterDataProvider, CreateClusterPanel } from "../../panels/CreateClusterPanel";
import { getReadySessionProvider } from "../../auth/azureAuth";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 *
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
    if (failed(subscriptionNode)) {
        vscode.window.showErrorMessage(subscriptionNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const panel = new CreateClusterPanel(extension.result.extensionUri);

    const dataProvider = new CreateClusterDataProvider(
        sessionProvider.result,
        subscriptionNode.result.subscriptionId,
        subscriptionNode.result.name,
        () => vscode.commands.executeCommand("aks.refreshSubscription", target),
    );

    panel.show(dataProvider);
}
