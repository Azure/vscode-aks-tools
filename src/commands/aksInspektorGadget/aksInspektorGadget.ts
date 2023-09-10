import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from '../utils/clusters';
import { getExtension } from '../utils/host';
import { failed } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import { getKubectlGadgetBinaryPath } from '../utils/helper/kubectlGadgetDownload';
import path = require('path');
import { InspektorGadgetDataProvider, InspektorGadgetPanel } from '../../panels/InspektorGadgetPanel';
import { KubectlClusterOperations } from './clusterOperations';
import { TraceWatcher } from './traceWatcher';
import { ensureDirectoryInPath } from '../utils/env';

export async function aksInspektorGadgetShow(
    _context: IActionContext,
    target: any
): Promise<void> {
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

    const kubectlGadgetPath = await getKubectlGadgetBinaryPath();
    if (failed(kubectlGadgetPath)) {
        vscode.window.showWarningMessage(`kubectl gadget path was not found ${kubectlGadgetPath.error}`);
        return;
    }

    ensureDirectoryInPath(path.dirname(kubectlGadgetPath.result));

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    const clusterOperations = new KubectlClusterOperations(kubectl, clusterInfo.result, kubeConfigFile.filePath);
    const traceWatcher = new TraceWatcher(clusterOperations, clusterInfo.result.name);
    const dataProvider = new InspektorGadgetDataProvider(clusterOperations, clusterInfo.result.name, traceWatcher);
    const panel = new InspektorGadgetPanel(extension.result.extensionUri);

    // Pass the disposables into the `show` method so that they get disposed when the panel is closed.
    panel.show(dataProvider, kubeConfigFile, traceWatcher);
}
