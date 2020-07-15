import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as buffer from 'buffer';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { parseResource } from '../../azure-api-utils';
import * as tmpfile from '../utils/tempfile';
import { getClusterKubeconfig } from '../../extension';
import { getExtensionPath, longRunning } from '../utils/host';
import {
  getClusterDiagnosticSettings,
  getStorageAccountKeyUI,
  getStorageInfo,
  replaceDeploymentAccountNameAndSas,
  generateDownloadableLinks,
  getWebviewContent
} from './helpers/storageandhtmlhelper';
import { PeriscopeStorage } from './models/storage';
import * as amon from 'azure-arm-monitor';

export default async function periscope(
  context: IActionContext,
  target: any
): Promise<void> {
  const kubectl = await k8s.extension.kubectl.v1;
  const cloudExp = await k8s.extension.cloudExplorer.v1;

  if (cloudExp.available && kubectl.available) {
    const cloudTarget = cloudExp.api.resolveCommandTarget(target);
    if (cloudTarget && cloudTarget.cloudName === "Azure" &&
      cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
      const cloudResource = cloudTarget.cloudResource;
      const clusterKubeConfig = await getClusterKubeconfig(cloudResource);
      if (clusterKubeConfig) {
        /**
          Three key parts for running aks-periscope on a cluster.
            1. Get the cluster diagnostic settings for account-storage or get it manually via UI.
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
              // If there is no Diagnostic setting - Present UI for user input.
              await getStorageAccountNameAndKeyUserInputAndInstallAKSPeriscope(clusterKubeConfig, cloudResource.name);
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

  let periscopeStorageInfo: PeriscopeStorage | undefined;
  const clusterName = cloudResource.name;

  /*
      Check the diagnostic setting is 1 or more than 1:
        1. For the scenario of 1 - Pick the storageId resource and get SAS.
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

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = "Select storage account for periscope deployment:";
    quickPick.title = `Found more than 1 storage account associated with cluster ${clusterName}. Please select from below.`;
    quickPick.ignoreFocusOut = true;
    quickPick.items = Array.from(storageAccountNameToStorageIdMap.keys()).map((label) => ({ label }));
    quickPick.onDidChangeSelection(async ([{ label }]) => {
      quickPick.hide();

      await longRunning(`Generate SAS for ${clusterName} cluster.`,
        async () => {
          periscopeStorageInfo = await getStorageInfo(cloudResource, storageAccountNameToStorageIdMap.get(label)!);
          await loadAndDeployPeriscope(clusterKubeConfig, periscopeStorageInfo, clusterName);
        }
      );
    });
    quickPick.show();
  } else if (diagnosticSettings && diagnosticSettings.value!.length === 1) {
    await longRunning(`Generate SAS for ${clusterName} cluster.`,
      async () => {
        periscopeStorageInfo = await getStorageInfo(cloudResource, diagnosticSettings.value![0].storageAccountId!);
        await loadAndDeployPeriscope(clusterKubeConfig, periscopeStorageInfo, clusterName);
      }
    );
  }
}

async function getStorageAccountNameAndKeyUserInputAndInstallAKSPeriscope(
  clusterKubeConfig: string,
  clusterName: string
) {
  let storageAccount = "";
  let storageKey = "";

  // "A storage account must be specified, since there isn't one in the diagnostic settings." Hence manual input- to be removed
  await vscode.window.showInputBox({ placeHolder: 'Enter storage account name:', ignoreFocusOut: true }).then(
    async (value) => {
      if (value) {
        storageAccount = value;
        await getStorageAccountKeyUI().then((value) => storageKey = value!);
      }
    });

  await longRunning(`Load and deploy for ${clusterName} cluster.`,
    async () => {
      if (storageKey && storageAccount) {
        storageAccount = buffer.Buffer.from(storageAccount).toString('base64');
        storageKey = buffer.Buffer.from(storageKey).toString('base64');
        const periscopeStorageInfo = <PeriscopeStorage>{ storageName: storageAccount, storageDeploymentSas: storageKey };

        await loadAndDeployPeriscope(clusterKubeConfig, periscopeStorageInfo, clusterName);
      }
    }
  );
}

async function loadAndDeployPeriscope(
  clusterKubeConfig: string,
  periscopeStorageInfo: PeriscopeStorage | undefined,
  clusterName: string) {

  await longRunning(`Installing aks periscope for ${clusterName} cluster.`,
    async () => {
      const kubectl = await k8s.extension.kubectl.v1;

      if (kubectl.available && periscopeStorageInfo) {
        await inMemoryAKSPeriscopeDeplomentFileHandle(clusterKubeConfig, kubectl, periscopeStorageInfo, clusterName);
      } else {
        vscode.window.showInformationMessage('Associated storage to the cluster have issues.');
      }
    }
  );
}

async function inMemoryAKSPeriscopeDeplomentFileHandle(
  clusterKubeConfig: string,
  kubectl: any,
  periscopeStorageInfo: PeriscopeStorage,
  clusterName: string
): Promise<string | undefined> {
  const https = require("https");
  const aksPeriscopeFile = fs.createWriteStream(path.resolve(__dirname, 'aks-periscope.yaml'));

  await longRunning(`Preparing AKS Periscope Install for ${clusterName} cluster.`,
    async () => {

      await https.get('https://raw.githubusercontent.com/Azure/aks-periscope/master/deployment/aks-periscope.yaml', async (res: any) => {
        console.log('statusCode:', res.statusCode);

        res.pipe(aksPeriscopeFile);
        aksPeriscopeFile.on('finish', async () => {
          aksPeriscopeFile.close();  // close() is async, call cb after close completes.

          // persicope file is written, replace the acc name and keys.
          replaceDeploymentAccountNameAndSas(periscopeStorageInfo, aksPeriscopeFile.path);

          await longRunning(`AKS Periscope deployment inprogress for ${clusterName}.`,
            async () => {
              // Clean up running instance.
              await tmpfile.withOptionalTempFile<any>(
                clusterKubeConfig,
                "YAML",
                (f) => kubectl.api.invokeCommand(`delete ns aks-periscope --kubeconfig="${f}"`));

              // Deploy the aks-periscope.
              const runCommandResult = await tmpfile.withOptionalTempFile<any>(
                clusterKubeConfig,
                "YAML",
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
  periscopeStorageInfo: PeriscopeStorage
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
  if (extensionPath) {

    panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, [], []);

    let downloadableNodeLogsList: string[] = [];
    let sevenDaysDownloadableNodeLogsList: string[] = [];

    panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log(message.command);
        await longRunning(`Generating storage downloadable link.`,
          async () => {
            if (message.command === "7days") {
              sevenDaysDownloadableNodeLogsList = await generateDownloadableLinks(periscopeStorageInfo, outputResult.stdout, true);
            } else {
              downloadableNodeLogsList = await generateDownloadableLinks(periscopeStorageInfo, outputResult.stdout);
            }
            panel.webview.html = getWebviewContent(clusterName, extensionPath, outputResult, periscopeStorageInfo, downloadableNodeLogsList, sevenDaysDownloadableNodeLogsList);
          });
      },
      undefined
    );
  }
}
