import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as tmpfile from "../utils/tempfile";
import * as k8s from "vscode-kubernetes-tools-api";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KaitoModelsPanelDataProvider } from "../../panels/KaitoModelsPanel";
import { KaitoModelsPanel } from "../../panels/KaitoModelsPanel";
import { filterPodName, getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension, longRunning } from "../utils/host";

export default async function aksKaitoCreateCRD(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
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

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const clusterName = clusterNode.result.name;
    const armId = clusterNode.result.armId;
    const subscriptionId = clusterNode.result.subscriptionId;
    const resourceGroupName = clusterNode.result.resourceGroupName;
    const filterKaitoPodNames = await longRunning(`Checking if KAITO is installed.`, () => {
        return filterPodName(sessionProvider.result, kubectl, subscriptionId, resourceGroupName, clusterName, "kaito-");
    });

    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return;
    }

    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showInformationMessage(
            `Please install Kaito for cluster ${clusterName}. \n \n Kaito Workspace generation is only enabled when kaito is installed. Skipping generation.`,
        );
        return;
    }
    const clusterInfo = await getKubernetesClusterInfo(sessionProvider.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }
    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");

    const panel = new KaitoModelsPanel(extension.result.extensionUri);
    const dataProvider = new KaitoModelsPanelDataProvider(
        clusterName,
        subscriptionId,
        resourceGroupName,
        armId,
        kubectl,
        kubeConfigFile.filePath,
    );
    panel.show(dataProvider);
}
