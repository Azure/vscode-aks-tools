import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KaitoModelsPanelDataProvider } from "../../panels/KaitoModelsPanel";
import { KaitoModelsPanel } from "../../panels/KaitoModelsPanel";
import { getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";

export default async function aksKaitoCreateCRD(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const kubectl = await k8s.extension.kubectl.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

    const clusterName = clusterNode.result.name;
    const armId = clusterNode.result.armId;
    const subscriptionId = clusterNode.result.subscriptionId;
    const resourceGroupName = clusterNode.result.resourceGroupName;

    const panel = new KaitoModelsPanel(extension.result.extensionUri);
    const dataProvider = new KaitoModelsPanelDataProvider(clusterName, subscriptionId, resourceGroupName, armId);
    panel.show(dataProvider);
}
