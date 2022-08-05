import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as tmpfile from '../utils/tempfile';
import { CloudType, getAksClusterTreeItem, getKubeconfigYaml } from '../utils/clusters';
import { getKustomizeConfig } from '../utils/config';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getClusterDiagnosticSettings,
    chooseStorageAccount,
    getStorageInfo,
    prepareAKSPeriscopeKustomizeOverlay,
    generateDownloadableLinks,
    getWebviewContent
} from './helpers/periscopehelper';
import { PeriscopeStorage } from './models/storage';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView } from '../utils/webviews';
import { Errorable, failed } from '../utils/errorable';
import { invokeKubectlCommand } from '../utils/kubectl';
import { getCloudType } from '../../azure-api-utils';

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

    if (!clusterDiagnosticSettings || !clusterDiagnosticSettings.value?.length) {
        // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
        await createPeriscopeWebView(cluster.name, undefined, undefined, false);
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

    const aksDeploymentFile = await longRunning(`Creating AKS Periscope resource specification for ${clusterName}.`,
        () => prepareAKSPeriscopeKustomizeOverlay(clusterStorageInfo.result, kustomizeConfig.result)
    );

    if (failed(aksDeploymentFile)) {
        vscode.window.showErrorMessage(aksDeploymentFile.error);
        return undefined;
    }

    const runCommandResult = await longRunning(`Deploying AKS Periscope to ${clusterName}.`,
        () => deployKustomizeOverlay(kubectl, aksDeploymentFile.result, clusterKubeConfig)
    );

    if (failed(runCommandResult)) {
        vscode.window.showErrorMessage(runCommandResult.error);
        return undefined;
    }

    await createPeriscopeWebView(clusterName, runCommandResult.result, clusterStorageInfo.result);
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

async function createPeriscopeWebView(
    clusterName: string,
    outputResult: k8s.KubectlV1.ShellResult | undefined,
    periscopeStorageInfo: PeriscopeStorage | undefined,
    hasDiagnosticSettings = true
): Promise<void | undefined> {
    const webview = createWebView('AKS Periscope', `AKS Periscope: ${clusterName}`).webview;

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return undefined;
    }

    if (!hasDiagnosticSettings) {
        // In case of no diagnostic setting we serve user with helpful content in webview and
        // a link as to how to attach the storage account to cluster's diagnostic settings.
        webview.html = getWebviewContent(clusterName, extensionPath.result, outputResult, undefined, [], hasDiagnosticSettings);
        return undefined;
    }

    if (periscopeStorageInfo) {
        // For the case of successful run of the tool we render webview with the output information.
        webview.html = getWebviewContent(clusterName, extensionPath.result, outputResult, periscopeStorageInfo, []);

        webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === "generateDownloadLink") {
                    // Generate link mechanism is in place due to current behaviour of the aks-periscope tool. (which seems by design for now)
                    // more detail here: https://github.com/Azure/aks-periscope/issues/30
                    const downloadableAndShareableNodeLogsList = await longRunning(`Generating links to Periscope logs.`,
                        () => generateDownloadableLinks(periscopeStorageInfo)
                    );

                    webview.html = getWebviewContent(clusterName, extensionPath.result, outputResult, periscopeStorageInfo, downloadableAndShareableNodeLogsList);
                }

            },
            undefined
        );
    }
}
