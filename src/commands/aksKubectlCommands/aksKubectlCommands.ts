import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from '../utils/clusters';
import { getExtension } from '../utils/host';
import { failed } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import { KubectlDataProvider, KubectlPanel } from '../../panels/KubectlPanel';
import { getKubectlCustomCommands } from '../utils/config';

export async function aksRunKubectlCommands(_context: IActionContext, target: any) {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

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

    const clusterInfo = await getKubernetesClusterInfo(target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const customCommands = getKubectlCustomCommands();

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const dataProvider = new KubectlDataProvider(kubectl, kubeConfigFile.filePath, clusterInfo.result.name, customCommands);
    const panel = new KubectlPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}
