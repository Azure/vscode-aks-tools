import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import * as clusters from '../utils/clusters';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';
import { invokeKubectlCommand } from '../utils/kubectl';
import { downloadKubeloginBinary } from '../utils/helper/kubelogicDownload';

export async function aksKubectlGetPodsCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `get pods --all-namespaces`;
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlGetClusterInfoCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `cluster-info`;
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlGetAPIResourcesCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `api-resources`;
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlGetNodeCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `get node`;
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlDescribeServicesCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `describe services`;
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlGetEventsCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = `get events --all-namespaces`;
  await aksKubectlCommands(_context, target, command);
}

async function aksKubectlCommands(
  _context: IActionContext,
  target: any,
  command: string
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    // Ensure kubelogin Binary
    const downloadResult = await longRunning(`Downloading Kubelogin.`, () =>
        downloadKubeloginBinary()
    );

    if (!downloadResult) {
      vscode.window.showErrorMessage('Failed to download Kubelogin');
      return undefined;
    }

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
      vscode.window.showErrorMessage(cluster.error);
      return;
    }

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
      vscode.window.showErrorMessage(extensionPath.error);
      return;
    }

    const clusterKubeConfig = await clusters.getKubeconfigYaml(cluster.result);
    if (failed(clusterKubeConfig)) {
        vscode.window.showErrorMessage(clusterKubeConfig.error);
        return undefined;
    }

    await loadKubectlCommandRun(cluster.result, extensionPath.result, clusterKubeConfig.result, command, kubectl);
}

async function loadKubectlCommandRun(
  cloudTarget: AksClusterTreeItem,
  extensionPath: string,
  clusterConfig: string,
  command: string,
  kubectl: k8s.APIAvailable<k8s.KubectlV1>) {

  const clustername = cloudTarget.name;
  await longRunning(`Loading ${clustername} kubectl command run.`,
    async () => {
      const kubectlresult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(clusterConfig, "YAML", async (kubeConfigFile) => {
        return await invokeKubectlCommand(kubectl, kubeConfigFile, command);
      });

      if (failed(kubectlresult)) {
        vscode.window.showErrorMessage(kubectlresult.error);
        return;
      }
      const webview = createWebView('AKS Kubectl Commands', `AKS Kubectl Command view for: ${clustername}`).webview;
      webview.html = getWebviewContent(kubectlresult.result, command, extensionPath, webview);
    }
  );
}

function getWebviewContent(
  clusterdata: k8s.KubectlV1.ShellResult,
  commandRun: string,
  vscodeExtensionPath: string,
  webview: vscode.Webview
  ): string {
    const styleUri = getResourceUri(webview, vscodeExtensionPath, 'common', 'detector.css');
    const templateUri = getResourceUri(webview, vscodeExtensionPath, 'aksKubectlCommand', 'akskubectlcommand.html');
    const data = {
      cssuri: styleUri,
      name: commandRun,
      command: clusterdata.stdout,
    };

    return getRenderedContent(templateUri, data);
}
