import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { parseResource } from '../../azure-api-utils';
import * as tmpfile from '../utils/tempfile';
import { getClusterKubeconfig } from '../../extension';
import { getExtensionPath, longRunning } from '../utils/host';
import {
  getClusterDiagnosticSettings,
  getStorageInfo,
  replaceDeploymentAccountNameAndSas,
  generateDownloadableLinks,
  getWebviewContent
} from './helpers/storageandhtmlhelper';
import { PeriscopeStorage, PeriscopeHTMLInterface } from './models/storage';
import * as amon from 'azure-arm-monitor';

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
        /**
          Three key parts for running aks-periscope on a cluster.
            1. Get the cluster diagnostic settings for account-storage.
            2. Generate SAS for the storage account selected\provided or default supplied.
            3. Run the clean-up and then aks-persicope on the cluster with current cluster kubeconfig.
            4. Generate Dowloadable link once action is performed at the webView.
        **/
        await longRunning(`Checking storage associated cluster.`,
          async () => {
            // Check if Diagnostic setting exist.
            const diagnosticSettings = await getClusterDiagnosticSettings(cloudResource);

            if (diagnosticSettings?.value?.length) {
              // If cluster diagnosticSetting exist pass it on for UI workflow and aks-preiscope deployment.
              await selectStorageAccountAndInstallAKSPeriscope(diagnosticSettings, clusterKubeConfig, cloudResource);
            } else if (!diagnosticSettings?.value?.length) {
              // If there is no storage account attached to diagnostic setting, don't move forward and at this point we will render webview with helpful content.
              await createPeriscopeWebView(cloudResource.name, undefined, undefined, false);
            }
          });
      }
    } else {
      vscode.window.showInformationMessage('This command only applies to AKS clusters.');
    }
  }
}

async function selectStorageAccountAndInstallAKSPeriscope(
  diagnosticSettings: amon.MonitorManagementModels.DiagnosticSettingsResourceCollection | undefined,
  clusterKubeConfig: string,
  cloudResource: any
) {
  const clusterName = cloudResource.name;
  let selectedStorageAccount: string;

  /*
      Check the diagnostic setting is 1 or more than 1:
        1. For the scenario of 1 storage account in diagnostic settings - Pick the storageId resource and get SAS.
        2. For the scenario for more than 1 then show VsCode quickPick to select and get SAS of selected.
  */

  if (diagnosticSettings && diagnosticSettings?.value!.length > 1) {
    const storageAccountNameToStorageIdMap: Map<string, string> = new Map();

    diagnosticSettings.value?.forEach((item): any => {
      if (item.storageAccountId) {
        const { name } = parseResource(item.storageAccountId!);
        if (!name) {
          vscode.window.showInformationMessage(`Storage Id is malformed: ${item.storageAccountId}`);
          return undefined;
        }
        storageAccountNameToStorageIdMap.set(name!, item.storageAccountId!);
      }
    });

    // create quick pick for more than 1 storage account scenario.
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = "Select storage account for periscope deployment:";
    quickPick.title = `Found more than 1 storage account associated with cluster ${clusterName}. Please select from below.`;
    quickPick.ignoreFocusOut = true;
    quickPick.items = Array.from(storageAccountNameToStorageIdMap.keys()).map((label) => ({ label }));

    quickPick.onDidChangeSelection(async ([{ label }]) => {
      quickPick.hide();
      selectedStorageAccount = storageAccountNameToStorageIdMap.get(label)!;
      await generateSASAndDeployPeriscope(cloudResource, selectedStorageAccount, clusterKubeConfig, clusterName);
    });

    quickPick.show();

  } else if (diagnosticSettings && diagnosticSettings.value!.length === 1) {
    // In case of only 1 storage account associated, use the one (1) as default storage account and no UI will be displayed.
    selectedStorageAccount = diagnosticSettings.value![0].storageAccountId!;
    await generateSASAndDeployPeriscope(cloudResource, selectedStorageAccount, clusterKubeConfig, clusterName);
  }
}

async function generateSASAndDeployPeriscope(
  cloudResource: any,
  selectedStorageAccount: string,
  clusterKubeConfig: string,
  clusterName: string
) {
  await longRunning(`Generate SAS for ${clusterName} cluster.`,
    async () => {
      let periscopeStorageInfo: PeriscopeStorage | undefined;
      periscopeStorageInfo = await getStorageInfo(cloudResource, selectedStorageAccount);
      await loadAndDeployPeriscope(clusterKubeConfig, periscopeStorageInfo, clusterName);
    });
}

async function loadAndDeployPeriscope(
  clusterKubeConfig: string,
  periscopeStorageInfo: PeriscopeStorage | undefined,
  clusterName: string
) {

  await longRunning(`Installing aks periscope for ${clusterName} cluster.`,
    async () => {
      const kubectl = await k8s.extension.kubectl.v1;

      if (kubectl.available && periscopeStorageInfo) {
        await inMemoryAKSPeriscopeDeplomentFileHandle(clusterKubeConfig, kubectl, periscopeStorageInfo, clusterName);
      }
    }
  );
}

async function inMemoryAKSPeriscopeDeplomentFileHandle(
  clusterKubeConfig: string,
  kubectl: k8s.APIAvailable<k8s.KubectlV1>,
  periscopeStorageInfo: PeriscopeStorage,
  clusterName: string
): Promise<string | undefined> {
  const https = require("https");
  const aksPeriscopeFile = fs.createWriteStream(path.resolve(__dirname, 'aks-periscope.yaml'));

  await longRunning(`Preparing AKS Periscope Install for ${clusterName} cluster.`,
    async () => {

      // Read the Raw deplyment file for aks-periscope tool.
      await https.get('https://raw.githubusercontent.com/Azure/aks-periscope/master/deployment/aks-periscope.yaml', async (res: any) => {

        res.pipe(aksPeriscopeFile);
        aksPeriscopeFile.on('finish', async () => {
          // Make sure the temp file is finished before adding keys and storage details.
          aksPeriscopeFile.close();  // close() is async, call cb after close completes.

          // Replace the storage account name and keys in persicope deplyment file.
          replaceDeploymentAccountNameAndSas(periscopeStorageInfo, aksPeriscopeFile.path);

          await longRunning(`AKS Periscope deployment inprogress for ${clusterName}.`,
            async () => {
              // Clean up running instance.
              await tmpfile.withOptionalTempFile<any>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`delete ns aks-periscope --kubeconfig="${f}"`));

              // Deploy the aks-periscope.
              const runCommandResult = await tmpfile.withOptionalTempFile<any>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${aksPeriscopeFile.path} --kubeconfig="${f}" && kubectl cluster-info --kubeconfig="${f}"`));

              await createPeriscopeWebView(clusterName, runCommandResult, periscopeStorageInfo);
            });
        });
      });
    });
  return undefined;
}

async function createPeriscopeWebView(
  clusterName: string,
  outputResult: any,
  periscopeStorageInfo: PeriscopeStorage | undefined,
  hasDiagnosticSettings = true
) {
  const panel = vscode.window.createWebviewPanel(
    'AKS Periscope',
    'AKS periscope view for : ' + clusterName,
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
