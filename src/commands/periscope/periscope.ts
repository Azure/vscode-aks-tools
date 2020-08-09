import * as vscode from 'vscode';
import * as fs from 'fs';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { getClusterKubeconfig } from '../../extension';
import * as tmpfile from '../utils/tempfile';
import { getExtensionPath, longRunning } from '../utils/host';
import {
  getClusterDiagnosticSettings,
  selectStorageAccountAndInstallAKSPeriscope,
  getStorageInfo,
  writeTempAKSDeploymentFile,
  replaceDeploymentAccountNameAndSas,
  generateDownloadableLinks,
  getWebviewContent
} from './helpers/periscopehelper';
import { PeriscopeStorage, PeriscopeHTMLInterface } from './models/storage';
const tmp = require('tmp');

export default async function periscope(
  context: IActionContext,
  target: any
): Promise<void> {
  const kubectl = await k8s.extension.kubectl.v1;
  const cloudExplorer = await k8s.extension.cloudExplorer.v1;

  if (cloudExplorer.available && kubectl.available) {
    const cloudTarget = cloudExplorer.api.resolveCommandTarget(target);
    if (cloudTarget && cloudTarget.cloudName === "Azure" &&
      cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
      const cloudResource = cloudTarget.cloudResource;
      const clusterKubeConfig = await getClusterKubeconfig(cloudResource);

      if (clusterKubeConfig) {
        await runAKSPeriscope(cloudTarget, clusterKubeConfig);
      }

    } else {
      vscode.window.showInformationMessage('This command only applies to AKS clusters.');
    }
  }
}

async function runAKSPeriscope(
  cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode,
  clusterKubeConfig: string
) {

  // Get Diagnostic settings for cluster and get associated storage account information.
  const clusterStorageAccountName = await getDiagnosticSettingsStorageAccount(cloudTarget, clusterKubeConfig);

  // Generate storage sas keys, manage aks persicope run.
  if (clusterStorageAccountName) {
    await manageStorageKeysAndAKSPeriscopeRun(cloudTarget, clusterKubeConfig, clusterStorageAccountName);
  }

}

async function getDiagnosticSettingsStorageAccount(
  cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode,
  clusterKubeConfig: string
): Promise<string | undefined> {
  return await longRunning(`Identifying cluster diagnostic settings and associated storage account.`,
    async () => {
      const clusterDiagnosticSettings = await getClusterDiagnosticSettings(cloudTarget.cloudResource);

      if (clusterDiagnosticSettings?.value?.length) {
        const storageAccountName = await selectStorageAccountAndInstallAKSPeriscope(clusterDiagnosticSettings, cloudTarget, clusterKubeConfig, manageStorageKeysAndAKSPeriscopeRun);
        return storageAccountName;
      } else {
        // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
        await createPeriscopeWebView(cloudTarget.cloudResource.name, undefined, undefined, false);
        return undefined;
      }
    });
}

async function manageStorageKeysAndAKSPeriscopeRun(
  cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode,
  clusterKubeConfig: string,
  clusterStorageAccountName: string
) {
  // Generate storage sas keys, manage aks persicope run.
  if (clusterStorageAccountName) {
    const clusterStorageInfo = await longRunning(`Generating SAS for ${cloudTarget.cloudResource.name} cluster.`,
      async () => {
        return await getStorageInfo(cloudTarget.cloudResource, clusterStorageAccountName);
      });

    if (clusterStorageInfo) {
      await loadAndDeployPeriscope(cloudTarget, clusterKubeConfig, clusterStorageInfo, cloudTarget.cloudResource.name);
    }
  }
}

async function loadAndDeployPeriscope(
  cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode,
  clusterKubeConfig: string,
  clusterStorageInfo: PeriscopeStorage | undefined,
  clusterName: string
) {

  await longRunning(`AKS Periscope deployment inprogress for ${clusterName} cluster.`,
    async () => {
      const kubectl = await k8s.extension.kubectl.v1;

      if (kubectl.available && clusterStorageInfo) {
        const tempFile = tmp.fileSync({ prefix: "aks-periscope-", postfix: `.yaml` });
        const periscopeDeploymentFile = fs.createWriteStream(tempFile.name);

        await writeTempAKSDeploymentFile(periscopeDeploymentFile);

        periscopeDeploymentFile.on('finish', async () => {
          await runAssociatedAKSPeriscopeCommand(clusterStorageInfo, tempFile?.name, clusterKubeConfig, cloudTarget.cloudResource.name, kubectl);
        });
      }
    }
  );
}

export async function runAssociatedAKSPeriscopeCommand(
  clusterStorageInfo: PeriscopeStorage,
  aksPeriscopeFile: string,
  clusterKubeConfig: string | undefined,
  clusterName: string,
  kubectl: any) {

  // Replace the storage account name and keys in persicope deplyment file.
  replaceDeploymentAccountNameAndSas(clusterStorageInfo, aksPeriscopeFile);

  await longRunning(`Running aks periscope on ${clusterName}.`,
    async () => {
      // Clean up running instance.
      await tmpfile.withOptionalTempFile<any>(
        clusterKubeConfig, "YAML",
        (f) => kubectl.api.invokeCommand(`delete ns aks-periscope --kubeconfig="${f}"`));

      // Deploy the aks-periscope.
      const runCommandResult = await tmpfile.withOptionalTempFile<any>(
        clusterKubeConfig, "YAML",
        (f) => kubectl.api.invokeCommand(`apply -f ${aksPeriscopeFile} --kubeconfig="${f}" && kubectl cluster-info --kubeconfig="${f}"`));

      await createPeriscopeWebView(clusterName, runCommandResult, clusterStorageInfo);

    });
}

async function createPeriscopeWebView(
  clusterName: string,
  outputResult: any,
  periscopeStorageInfo: PeriscopeStorage | undefined,
  hasDiagnosticSettings = true
) {
  const panel = vscode.window.createWebviewPanel(
    `AKS Periscope`,
    `AKS periscope: ${clusterName}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      enableCommandUris: true
    }
  );

  const extensionPath = getExtensionPath();

  if (extensionPath && !hasDiagnosticSettings) {
    // In case of no diagnostic setting we serve user with helpful content in webview and
    // a link as to how to attach the storage account to cluster's diagnostic settings.
    panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, undefined, [], hasDiagnosticSettings);
  }

  if (extensionPath && periscopeStorageInfo) {
    // For the case of successful run of the tool we render webview with the output information.
    panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, []);

    let downloadableAndShareableNodeLogsList: PeriscopeHTMLInterface[] | undefined;

    panel.webview.onDidReceiveMessage(
      async (message) => {
        await longRunning(`Generating storage downloadable link.`,
          async () => {
            if (message.command === "generateDownloadLink") {
              // Generate link mechanism is in place due to current behaviour of the aks-periscope tool. (which seems by design for now)
              // more detail here: https://github.com/Azure/aks-periscope/issues/30
              downloadableAndShareableNodeLogsList = await generateDownloadableLinks(periscopeStorageInfo, outputResult.stdout);
              panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, downloadableAndShareableNodeLogsList);
            }
          });
      },
      undefined
    );
  }
}
