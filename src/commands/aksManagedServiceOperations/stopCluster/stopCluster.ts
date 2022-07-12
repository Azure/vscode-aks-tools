import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem, stopCluster } from '../../utils/clusters';
import { getExtensionPath, longRunning }  from '../../utils/host';
import { failed } from '../../utils/errorable';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri } from '../../utils/webviews';

export default async function aksStopCluster(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

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

    await loadClusterProperties(cluster.result, extensionPath.result);
}

async function loadClusterProperties(
    cloudTarget: AksClusterTreeItem,
    extensionPath: string) {

    const clustername = cloudTarget.name;
    await longRunning(`Stopping ${clustername} cluster.`,
      async () => {
        const clusterInfo = await stopCluster(cloudTarget, clustername);
        if (failed(clusterInfo)) {
          vscode.window.showErrorMessage(clusterInfo.error);
          return;
        }

        const webview = createWebView('AKS Cluster Start/Stop', `AKS Start and Stop view for: ${clustername}`);

        webview.html = getWebviewContent(extensionPath, clustername);
      }
    );
}

function getWebviewContent(
    vscodeExtensionPath: string,
    clusterName: string
    ): string {
      const styleUri = getResourceUri(vscodeExtensionPath, 'common', 'detector.css');
      const templateUri = getResourceUri(vscodeExtensionPath, 'aksstartstopcluster', 'clusterstartstop.html');
      const data = {
        cssuri: styleUri,
        name: clusterName,
        operationName: "Stop"
      };

      return getRenderedContent(templateUri, data);
  }

// POST https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/{resourceName}/start?api-version=2022-04-01