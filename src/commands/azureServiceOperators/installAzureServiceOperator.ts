import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import { createTempFile } from "../utils/tempfile";
import { AzureServiceOperatorDataProvider, AzureServiceOperatorPanel } from "../../panels/AzureServiceOperatorPanel";

export default async function installAzureServiceOperator(_context: IActionContext, target: unknown): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const clusterInfo = await getKubernetesClusterInfo(target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return undefined;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return undefined;
    }

    const kubeConfigFile = await createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const dataProvider = new AzureServiceOperatorDataProvider(
        extension.result,
        kubectl,
        kubeConfigFile.filePath,
        clusterInfo.result.name,
    );
    const panel = new AzureServiceOperatorPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}
