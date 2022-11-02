import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as tmpfile from '../utils/tempfile';
import { CloudType, getAksClusterTreeItem, getContainerClient, getKubeconfigYaml } from '../utils/clusters';
import { getKustomizeConfig } from '../utils/config';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getClusterDiagnosticSettings,
    chooseStorageAccount,
    getStorageInfo,
    prepareAKSPeriscopeKustomizeOverlay,
    getNodeNames,
    getSuccessWebviewContent,
    getFailureWebviewContent,
    getNoDiagSettingWebviewContent,
    getClusterFeatures,
    checkUploadStatus,
    getNodeLogs
} from './helpers/periscopehelper';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView } from '../utils/webviews';
import { Errorable, failed } from '../utils/errorable';
import { invokeKubectlCommand } from '../utils/kubectl';
import { getCloudType } from '../../azure-api-utils';
import { PeriscopeStorage } from './models/storage';

export default async function periscope(
    _context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return;
    }

    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // Once Periscope will support usgov endpoints all we need is to remove this check.
    // I have done background plumbing for vscode to fetch downlodable link from correct endpoint.
    const cloudType = getCloudType(cluster.result);

    switch (cloudType) {
        case CloudType.USGov:
          vscode.window.showInformationMessage(`Periscope is not supported in ${cloudType} cloud.`);
          return;
        case CloudType.Public:
          break;
        default:
          vscode.window.showErrorMessage(`Unrecognised cloud type ${cloudType}.`);
          return;
      }

    const clusterKubeConfig = await getKubeconfigYaml(cluster.result);
    if (failed(clusterKubeConfig)) {
        vscode.window.showErrorMessage(clusterKubeConfig.error);
        return;
    }

    await runAKSPeriscope(kubectl, cluster.result, clusterKubeConfig.result);
}

async function runAKSPeriscope(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    cluster: AksClusterTreeItem,
    clusterKubeConfig: string
): Promise<void> {
    const clusterName = cluster.name;

    // Get Diagnostic settings for cluster and get associated storage account information.
    const clusterDiagnosticSettings = await longRunning(`Identifying cluster diagnostic settings.`,
        () => getClusterDiagnosticSettings(cluster)
    );

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return undefined;
    }

    if (!clusterDiagnosticSettings || !clusterDiagnosticSettings.value?.length) {
        // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
        const webview = createWebView('AKS Periscope', `AKS Periscope: ${clusterName}`).webview;
        webview.html = getNoDiagSettingWebviewContent(extensionPath.result, clusterName);
        return undefined;
    }

    const clusterStorageAccountId = await chooseStorageAccount(clusterDiagnosticSettings);

    // Generate storage sas keys, manage aks persicope run.
    if (!clusterStorageAccountId) return undefined;

    const clusterStorageInfo = await longRunning(`Generating SAS for ${clusterName} cluster.`,
        () => getStorageInfo(kubectl, cluster, clusterStorageAccountId, clusterKubeConfig)
    );

    if (failed(clusterStorageInfo)) {
        vscode.window.showErrorMessage(clusterStorageInfo.error);
        return undefined;
    }

    const kustomizeConfig = getKustomizeConfig();
    if (failed(kustomizeConfig)) {
        vscode.window.showErrorMessage(kustomizeConfig.error);
        return undefined;
    }

    const containerClient = getContainerClient(cluster);

    // Get the features of the cluster that determine which optional kustomize components to deploy.
    const clusterFeatures = await getClusterFeatures(containerClient, cluster.resourceGroupName, cluster.name);
    if (failed(clusterFeatures)) {
        vscode.window.showErrorMessage(clusterFeatures.error);
        return undefined;
    }

    // Create a run ID of format: YYYY-MM-DDThh-mm-ssZ
    const runId = new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "Z";

    const aksDeploymentFile = await longRunning(`Creating AKS Periscope resource specification for ${clusterName}.`,
        () => prepareAKSPeriscopeKustomizeOverlay(clusterStorageInfo.result, kustomizeConfig.result, clusterFeatures.result, runId)
    );

    if (failed(aksDeploymentFile)) {
        vscode.window.showErrorMessage(aksDeploymentFile.error);
        return undefined;
    }

    const nodeNames = await getNodeNames(kubectl, clusterKubeConfig);
    if (failed(nodeNames)) {
        vscode.window.showErrorMessage(nodeNames.error);
        return undefined;
    }

    const runCommandResult = await longRunning(`Deploying AKS Periscope to ${clusterName}.`,
        () => deployKustomizeOverlay(kubectl, aksDeploymentFile.result, clusterKubeConfig)
    );

    if (failed(runCommandResult)) {
        // For a failure running the command result, we display the error in a webview.
        const webview = createWebView('AKS Periscope', `AKS Periscope: ${clusterName}`).webview;
        webview.html = getFailureWebviewContent(extensionPath.result, clusterName, runCommandResult.error, kustomizeConfig.result);
        return undefined;
    }

    const webview = createWebView('AKS Periscope', `AKS Periscope: ${clusterName}`).webview;
    webview.html = getSuccessWebviewContent(extensionPath.result, runId, clusterName, clusterStorageInfo.result, nodeNames.result);
    handleMessages(webview, kubectl, clusterKubeConfig, clusterStorageInfo.result, 'aks-periscope', runId, nodeNames.result);
}

async function deployKustomizeOverlay(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    overlayDir: string,
    clusterKubeConfig: string
): Promise<Errorable<k8s.KubectlV1.ShellResult>> {
    return await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(clusterKubeConfig, "YAML", async kubeConfigFile => {
        // Clean up running instance (without an error if it doesn't yet exist).
        const deleteResult = await invokeKubectlCommand(kubectl, kubeConfigFile, 'delete ns aks-periscope --ignore-not-found=true');
        if (failed(deleteResult)) return deleteResult;

        // Deploy aks-periscope.
        const applyResult = await invokeKubectlCommand(kubectl, kubeConfigFile, `apply -k ${overlayDir}`);
        if (failed(applyResult)) return applyResult;

        return invokeKubectlCommand(kubectl, kubeConfigFile, 'cluster-info');
    });
}

function handleMessages(
    webview: vscode.Webview,
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string,
    storage: PeriscopeStorage,
    periscopeNamespace: string,
    runId: string,
    nodeNames: string[]
) {
    webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case "upload_status_request":
                {
                    const uploadStatuses = await checkUploadStatus(storage, runId, nodeNames);
                    webview.postMessage({ command: 'upload_status_response', uploadStatuses });
                    break;
                }
                case "node_logs_request":
                {
                    const nodeName = message.nodeName;
                    const logs = await longRunning(`Getting logs for node ${nodeName}.`,
                        () => getNodeLogs(kubectl, clusterKubeConfig, periscopeNamespace, nodeName)
                    );

                    if (failed(logs)) {
                        vscode.window.showErrorMessage(logs.error);
                        return;
                    }

                    webview.postMessage({ command: 'node_logs_response', nodeName, logs: logs.result });
                    break;
                }
            }
        },
        undefined
    );
}
