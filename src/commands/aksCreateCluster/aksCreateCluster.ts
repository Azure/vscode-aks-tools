import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionNode, getContainerClient, getResourceManagementClient } from "../utils/clusters";
import { failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { CreateClusterDataProvider, CreateClusterPanel } from "../../panels/CreateClusterPanel";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 *
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

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

    const resourceManagementClient = getResourceManagementClient(subscriptionNode.result);
    const containerServiceClient = getContainerClient(subscriptionNode.result);
    const dataProvider = new CreateClusterDataProvider(
        resourceManagementClient,
        containerServiceClient,
        subscriptionNode.result.subscription,
        () => vscode.commands.executeCommand("aks.refreshSubscription", target),
    );

    panel.show(dataProvider);
}
