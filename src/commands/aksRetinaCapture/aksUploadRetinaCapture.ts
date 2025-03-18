import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { chooseStorageAccount, getKubernetesClusterInfo } from "../utils/clusters";
import { getExtension, longRunning } from "../utils/host";
import * as tmpfile from "../utils/tempfile";
import path from "path";
import { ensureDirectoryInPath } from "../utils/env";
import { getRetinaBinaryPath } from "../utils/helper/retinaBinaryDownload";
import { invokeKubectlCommand } from "../utils/kubectl";
import { RetinaCapturePanel, RetinaCaptureProvider } from "../../panels/RetinaCapturePanel";
import { failed } from "../utils/errorable";
import { getClusterDiagnosticSettings, validatePrerequisites as validatePrerequisites } from "../utils/clusters";
import { getAksClusterTreeNode } from "../utils/clusters";
import {
    chooseContainerInStorageAccount as chooseContainerFromStorageAccount,
    getStorageAcctInfo,
    getSASKey,
    LinkDuration,
} from "../utils/azurestorage";
import { parseResource } from "../../azure-api-utils";
import { selectLinuxNodes } from "./utils";

export async function aksUploadRetinaCapture(_context: IActionContext, target: unknown): Promise<void> {
    const validation = await validatePrerequisites();
    if (failed(validation)) {
        vscode.window.showErrorMessage(validation.error);
        return;
    }
    const { kubectl, cloudExplorer, clusterExplorer, sessionProvider } = validation.result;

    const clusterInfo = await getKubernetesClusterInfo(sessionProvider, target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const kubeConfigFile = await tmpfile.createTempFile(clusterInfo.result.kubeconfigYaml, "yaml");

    // Get diagnostic settings for the cluster
    const clusterDiagnosticSettings = await getClusterDiagnosticSettings(sessionProvider, clusterNode.result);
    if (!clusterDiagnosticSettings || !clusterDiagnosticSettings.value?.length) {
        vscode.window.showErrorMessage(
            "No storage account is attached to the diagnostic setting. Please attach a storage account and try again.",
        );
        return;
    }

    // Get storage account selected by user to upload artifacts or default if only one storage account is available.
    const clusterStorageAccountId = await chooseStorageAccount(
        clusterDiagnosticSettings,
        "Select storage account to upload artifacts:",
    );
    if (!clusterStorageAccountId) return;

    const storageAccountName = parseResource(clusterStorageAccountId).name;
    if (!storageAccountName) {
        vscode.window.showInformationMessage(`Storage ID is malformed: ${clusterStorageAccountId}`);
        return;
    }

    // Get storage account details
    const storageInfo = await getStorageAcctInfo(sessionProvider, clusterNode.result, clusterStorageAccountId);
    if (failed(storageInfo)) {
        vscode.window.showErrorMessage(storageInfo.error);
        return;
    }

    const containerName = await chooseContainerFromStorageAccount(
        clusterStorageAccountId,
        storageInfo.result.blobEndpoint,
    );
    if (!containerName) return;

    // Get SAS key
    const sasKey = getSASKey(storageAccountName, storageInfo.result.storageKey, LinkDuration.DownloadNow); // using duration DownloadNow for create permissions

    // Construct SAS URI
    const sasUri = new URL(`${containerName}${sasKey}`, storageInfo.result.blobEndpoint).href;

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

    const selectedNodes = await selectLinuxNodes(kubectl, kubeConfigFile.filePath);
    if (failed(selectedNodes)) {
        vscode.window.showErrorMessage(selectedNodes.error);
        return;
    }

    // Retina Run Capture
    const captureName = `retina-capture-${clusterInfo.result.name.toLowerCase()}`;
    const retinaCaptureResult = await longRunning(
        `Retina Distributed Capture running for cluster ${clusterInfo.result.name}.`,
        async () => {
            return await invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `retina capture create --namespace default --name ${captureName} --node-selectors "kubernetes.io/os=linux" --node-names "${selectedNodes.result}" --no-wait=false --blob-upload="${sasUri}"`,
            );
        },
    );

    if (failed(retinaCaptureResult)) {
        vscode.window.showErrorMessage(`Failed to capture the cluster: ${retinaCaptureResult.error}`);
        return;
    }

    if (retinaCaptureResult.result.stdout && retinaCaptureResult.result.code === 0) {
        vscode.window.showInformationMessage(
            `Retina distributed capture is successfully completed and uploaded to Blob Storage ${storageAccountName}`,
        );
    }

    const isDownloadRetinaCapture = false;

    const dataProvider = new RetinaCaptureProvider(
        retinaCaptureResult.result.stdout,
        clusterInfo.result.name,
        isDownloadRetinaCapture,
    );

    const panel = new RetinaCapturePanel(extension.result.extensionUri);
    panel.show(dataProvider);
}
