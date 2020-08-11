import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import * as tmpfile from '../utils/tempfile';
import * as clusters from '../utils/clusters';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getClusterDiagnosticSettings,
    chooseStorageAccount,
    getStorageInfo,
    writeTempAKSDeploymentFile,
    generateDownloadableLinks,
    getWebviewContent
} from './helpers/periscopehelper';
import { PeriscopeStorage } from './models/storage';
const tmp = require('tmp');

export default async function periscope(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available && kubectl.available) {
        const cluster = cloudExplorer.api.resolveCommandTarget(target);

        if (cluster && cluster.cloudName === "Azure" &&
            cluster.nodeType === "resource" && cluster.cloudResource.nodeType === "cluster") {
            const cloudResource = cluster.cloudResource;
            const clusterKubeConfig = await clusters.getKubeconfigYaml(cloudResource);

            if (clusterKubeConfig) {
                await runAKSPeriscope(cluster, clusterKubeConfig);
            }
        } else {
            vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function runAKSPeriscope(
    cluster: k8s.CloudExplorerV1.CloudExplorerResourceNode,
    clusterKubeConfig: string
) {
    const clusterName = cluster.cloudResource.name;

    // Get Diagnostic settings for cluster and get associated storage account information.
    const clusterStorageAccountId = await longRunning(`Identifying cluster diagnostic settings and associated storage account.`,
        () => getDiagnosticSettingsStorageAccount(cluster)
    );

    // Generate storage sas keys, manage aks persicope run.
    if (clusterStorageAccountId) {
        const clusterStorageInfo = await longRunning(`Generating SAS for ${clusterName} cluster.`,
            () => getStorageInfo(cluster, clusterStorageAccountId)
        );

        if (clusterStorageInfo) {
            const aksDeplymentFile = await longRunning(`Deploying AKS Periscope to ${clusterName}.`,
                () => prepareAKSPeriscopeDeploymetFile(clusterStorageInfo)
            );

            if (aksDeplymentFile) {
                const runCommandResult = await longRunning(`Running AKS Periscope on ${clusterName}.`,
                    () => runAssociatedAKSPeriscopeCommand(aksDeplymentFile, clusterKubeConfig)
                );

                await longRunning(`Loading AKS Periscope output for ${clusterName}.`,
                    () => createPeriscopeWebView(clusterName, runCommandResult, clusterStorageInfo)
                );
            }
        }
    }
}

async function getDiagnosticSettingsStorageAccount(
    cluster: k8s.CloudExplorerV1.CloudExplorerResourceNode,
): Promise<string | undefined> {
    const clusterDiagnosticSettings = await getClusterDiagnosticSettings(cluster);

    if (clusterDiagnosticSettings?.value?.length) {
        const storageAccountId = await chooseStorageAccount(clusterDiagnosticSettings);
        return storageAccountId;
    } else {
        // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
        await createPeriscopeWebView(cluster.cloudResource.name, undefined, undefined, false);
        return undefined;
    }
}

async function prepareAKSPeriscopeDeploymetFile(
    clusterStorageInfo: PeriscopeStorage
): Promise<string | undefined> {
    const tempFile = tmp.fileSync({ prefix: "aks-periscope-", postfix: `.yaml` });
    writeTempAKSDeploymentFile(clusterStorageInfo, tempFile.name);

    return tempFile.name;
}

export async function runAssociatedAKSPeriscopeCommand(
    aksPeriscopeFile: string,
    clusterKubeConfig: string | undefined
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const kubectl = await k8s.extension.kubectl.v1;

    if (kubectl.available) {
        // Clean up running instance.
        await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`delete ns aks-periscope --kubeconfig="${f}"`));

        // Deploy the aks-periscope.
        const runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`apply -f ${aksPeriscopeFile} --kubeconfig="${f}" && kubectl cluster-info --kubeconfig="${f}"`));

        return runCommandResult;
    } else {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }
}

async function createPeriscopeWebView(
    clusterName: string,
    outputResult: k8s.KubectlV1.ShellResult | undefined,
    periscopeStorageInfo: PeriscopeStorage | undefined,
    hasDiagnosticSettings = true
): Promise<void | undefined> {
    const panel = vscode.window.createWebviewPanel(
        `AKS Periscope`,
        `AKS Periscope: ${clusterName}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    const extensionPath = getExtensionPath();

    if (!extensionPath) {
        return undefined;
    }

    if (!hasDiagnosticSettings) {
        // In case of no diagnostic setting we serve user with helpful content in webview and
        // a link as to how to attach the storage account to cluster's diagnostic settings.
        panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, undefined, [], hasDiagnosticSettings);
        return undefined;
    }

    if (periscopeStorageInfo) {
        // For the case of successful run of the tool we render webview with the output information.
        panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, []);

        panel.webview.onDidReceiveMessage(
            async (message) => {
                await longRunning(`Generating links to Periscope logs.`,
                    async () => {
                        if (message.command === "generateDownloadLink") {
                            // Generate link mechanism is in place due to current behaviour of the aks-periscope tool. (which seems by design for now)
                            // more detail here: https://github.com/Azure/aks-periscope/issues/30
                            const downloadableAndShareableNodeLogsList = await generateDownloadableLinks(periscopeStorageInfo, outputResult!.stdout);
                            panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, downloadableAndShareableNodeLogsList);
                        }
                    });
            },
            undefined
        );
    }
}
