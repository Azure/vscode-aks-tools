import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem, getClusterProperties, getKubeconfigYaml } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import * as tmpfile from '../utils/tempfile';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';
import { invokeKubectlCommand } from '../utils/kubectl';

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

export async function aksKubectlK8sHealthzAPIEndpointCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = "get --raw /healthz?verbose";
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlK8sLivezAPIEndpointCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = "get --raw /livez?verbose";
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlK8sReadyzAPIEndpointCommands(
  _context: IActionContext,
  target: any
): Promise<void> {
  const command = "get --raw /readyz?verbose";
  await aksKubectlCommands(_context, target, command);
}

export async function aksKubectlCommands(
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

    const properties = await longRunning(`Getting properties for cluster ${cluster.result.name}.`, () => getClusterProperties(cluster.result));
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${cluster.result.name}.`, () => getKubeconfigYaml(cluster.result, properties.result));
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    await loadKubectlCommandRun(cluster.result, extensionPath.result, kubeconfig.result, command, kubectl);
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
