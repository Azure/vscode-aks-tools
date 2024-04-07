import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import * as tmpfile from "../utils/tempfile";
import path from "path";
// import { InspektorGadgetDataProvider, InspektorGadgetPanel } from "../../panels/InspektorGadgetPanel";
// import { KubectlClusterOperations } from "./clusterOperations";
// import { TraceWatcher } from "./traceWatcher";
import { ensureDirectoryInPath } from "../utils/env";
import { getRetinaBinaryPath } from "../utils/helper/retinaBinaryDownload";
import { invokeKubectlCommand } from "../utils/kubectl";

export async function aksRetinaCapture(_context: IActionContext, target: unknown): Promise<void> {
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

    const kubectlRetinaPath = await getRetinaBinaryPath();
    if (failed(kubectlRetinaPath)) {
        vscode.window.showWarningMessage(`kubectl retina path was not found ${kubectlRetinaPath.error}`);
        return;
    }

    ensureDirectoryInPath(path.dirname(kubectlRetinaPath.result));

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");
    console.log(`Kubeconfig file: ${kubeConfigFile}`);
    const retinaCaptureResult = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile.filePath, // Fix: Pass the file path instead of the TempFile object
        `retina capture create --host-path /mnt/capture --node-selectors "kubernetes.io/os=linux"`,
    );

    console.log(`Retina capture result: ${retinaCaptureResult}`);
    vscode.window.showInformationMessage(`Retina capture result: ${retinaCaptureResult.succeeded ? retinaCaptureResult.result.stdout : retinaCaptureResult.error}`);
    // const kubectlClusterOperations = new KubectlClusterOperations(kubectl.api, clusterInfo.result, kubeConfigFile);

}
