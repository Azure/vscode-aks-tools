import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from '../utils/clusters';
import { getExtension } from '../utils/host';
import { Errorable, failed, map as errmap } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import { TcpDumpDataProvider, TcpDumpPanel } from '../../panels/TcpDumpPanel';
import { getVersion, invokeKubectlCommand } from '../utils/kubectl';

export async function aksTCPDump(_context: IActionContext, target: any) {
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

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const linuxNodesList = await getLinuxNodes(kubectl, kubeConfigFile.filePath);
    if (failed(linuxNodesList)) {
        vscode.window.showErrorMessage(linuxNodesList.error);
        return;
    }

    const kubectlVersion = await getVersion(kubectl, kubeConfigFile.filePath);
    if (failed(kubectlVersion)) {
        vscode.window.showErrorMessage(kubectlVersion.error);
        return;
    }

    const dataProvider = new TcpDumpDataProvider(kubectl, kubeConfigFile.filePath, kubectlVersion.result, clusterInfo.result.name, linuxNodesList.result);
    const panel = new TcpDumpPanel(extension.result.extensionUri);

    panel.show(dataProvider, kubeConfigFile);
}

async function getLinuxNodes(kubectl: k8s.APIAvailable<k8s.KubectlV1>, kubeConfigFile: string): Promise<Errorable<string[]>> {
    const command = `get node -l kubernetes.io/os=linux --no-headers -o custom-columns=":metadata.name"`;
    const commandResult = await invokeKubectlCommand(kubectl, kubeConfigFile, command);
    return errmap(commandResult, sr => sr.stdout.trim().split("\n"));
}