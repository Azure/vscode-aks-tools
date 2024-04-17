import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension, longRunning } from "../utils/host";
import * as tmpfile from "../utils/tempfile";
import path from "path";
import { ensureDirectoryInPath } from "../utils/env";
import { getRetinaBinaryPath } from "../utils/helper/retinaBinaryDownload";
import { getVersion, invokeKubectlCommand } from "../utils/kubectl";
import { RetinaCapturePanel, RetinaCaptureProvider } from "../../panels/RetinaCapturePanel";
import { failed } from "../utils/errorable";

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

    // Get all Nodes For this Cluster
    const nodelistResult = await invokeKubectlCommand(
        kubectl,
        kubeConfigFile.filePath,
        `get nodes -o jsonpath="{range .items[*]}{.metadata.name}{' '}{end}"`,
    );

    if (failed(nodelistResult)) {
        vscode.window.showErrorMessage(`Failed to capture the cluster: ${nodelistResult.error}`);
        return;
    }
    const nodesList = nodelistResult.result.stdout.trim().split(" ").map((nodeName) => ({ label: nodeName }));

    // Pick a cluster from group to compare with
    const nodeNamesSelected = await vscode.window.showQuickPick(nodesList, {
        canPickMany: true,
        placeHolder: "Please select all the Nodes you want Retina to capture traffic from.",
        title: "Select Nodes to Capture Traffic From",
    });

    if (!nodeNamesSelected) {
        vscode.window.showErrorMessage('No nodes were selected to capture traffic.');
        return;
    }

    const selectedNodes = nodeNamesSelected.map((item) => item.label).join(",");

    if (!selectedNodes) {
        return;
    }

    // Retina Run Capture
    const retinaCaptureResult = await longRunning(`Retina Distributed Capture running for cluster ${clusterInfo.result.name}.`, async () => {
        return await invokeKubectlCommand(
            kubectl,
            kubeConfigFile.filePath,
            `retina capture create --host-path /mnt/capture --node-selectors "kubernetes.io/os=linux" --node-names "${selectedNodes}" --no-wait=false`,
        )
    });

    if (failed(retinaCaptureResult)) {
        vscode.window.showErrorMessage(`Failed to capture the cluster: ${retinaCaptureResult.error}`);
        return;
    }

    if (retinaCaptureResult.result.stderr || retinaCaptureResult.result.code !== 0) {
        vscode.window.showInformationMessage(`Retina distributed capture failed with following error. ${retinaCaptureResult.result.stdout}`);
        return;
    }

    if (retinaCaptureResult.result.stdout && retinaCaptureResult.result.code === 0) {
        vscode.window.showInformationMessage(`Retina distributed capture is successfully completed for the cluster ${clusterInfo.result.name}`);
    }

    const kubectlVersion = await getVersion(kubectl, kubeConfigFile.filePath);
    if (failed(kubectlVersion)) {
        vscode.window.showErrorMessage(kubectlVersion.error);
        return;
    }

    // The pattern of the folder should reflect the pod names and time of the capture
    const pat = /retina-capture-\w+/g;
    const match = retinaCaptureResult.result.stdout.match(pat);
    const startwith = match ? match[0] : null;
    const foldername = `${clusterInfo.result.name}_${startwith}_${(new Date().toJSON().replaceAll(":", ""))}`;

    const dataProvider = new RetinaCaptureProvider(
        kubectl,
        kubeConfigFile.filePath,
        clusterInfo.result.name,
        retinaCaptureResult.result.stdout,
        selectedNodes.split(","),
        `${foldername}`
    );

    const panel = new RetinaCapturePanel(extension.result.extensionUri);
    panel.show(dataProvider);
}
