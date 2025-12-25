import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KaitoPanel, KaitoPanelDataProvider } from "../../panels/KaitoPanel";
import { filterPodName, getAksClusterTreeNode, getKubernetesClusterInfo } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import * as tmpfile from "../utils/tempfile";

export default async function aksKaito(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;
    const kubectl = await k8s.extension.kubectl.v1;
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
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

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const clusterInfo = await getKubernetesClusterInfo(sessionProvider.result, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
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

    const { name: clusterName, armId, subscriptionId, resourceGroupName } = clusterNode.result;
    const panel = new KaitoPanel(extension.result.extensionUri);

    const filterKaitoPodNames = await filterPodName(
        sessionProvider.result,
        kubectl,
        subscriptionId,
        resourceGroupName,
        clusterName,
        "kaito-",
    );

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");

    const dataProvider = new KaitoPanelDataProvider(
        clusterName,
        subscriptionId,
        resourceGroupName,
        armId,
        sessionProvider.result,
        filterKaitoPodNames.succeeded ? filterKaitoPodNames.result : [],
        kubectl,
        kubeConfigFile.filePath,
        target,
    );

    panel.show(dataProvider);
}
