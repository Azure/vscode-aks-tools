import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { ClusterARMResponse, getAksClusterTreeItem, getClusterProperties } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { failed } from '../utils/errorable';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';

export default async function aksClusterProperties(
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
    await longRunning(`Loading ${clustername} cluster properties.`,
      async () => {
        const clusterInfo = await getClusterProperties(cloudTarget, clustername);
        if (failed(clusterInfo)) {
          vscode.window.showErrorMessage(clusterInfo.error);
          return;
        }

        const webview = createWebView('AKS Cluster Properties', `AKS properties view for: ${clustername}`);

        webview.html = getWebviewContent(clusterInfo.result, extensionPath);
      }
    );
}

function getWebviewContent(
    clusterdata: ClusterARMResponse,
    vscodeExtensionPath: string
    ): string {
      const webviewClusterData = clusterdata?.properties;
      const styleUri = getResourceUri(vscodeExtensionPath, 'common', 'detector.css');
      const templateUri = getResourceUri(vscodeExtensionPath, 'aksclusterproperties', 'clusterproperties.html');
      const data = {
        cssuri: styleUri,
        name: clusterdata.name,
        clusterData: webviewClusterData
      };

      return getRenderedContent(templateUri, data);
  }
