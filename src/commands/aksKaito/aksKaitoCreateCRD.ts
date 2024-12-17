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
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return;
    }

    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return;
    }

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

    const { name: clusterName, armId, subscriptionId, resourceGroupName } = clusterNode.result;

    // "kaito-" is assuming kaito pods are still named kaito-workspace & kaito-gpu-provisioner
    const filterKaitoPodNames = await longRunning(`Checking if KAITO is installed.`, () => {
        return filterPodName(sessionProvider.result, kubectl, subscriptionId, resourceGroupName, clusterName, "kaito-");
    });

    if (failed(filterKaitoPodNames)) {
        vscode.window.showErrorMessage(filterKaitoPodNames.error);
        return;
    }

    if (filterKaitoPodNames.result.length === 0) {
        vscode.window.showWarningMessage(
            `Please install KAITO for cluster ${clusterName}. \n \n KAITO Workspace generation is only enabled when KAITO is installed.`,
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
        sessionProvider.result,
        target,
    );
    panel.show(dataProvider, kubeConfigFile);
}
