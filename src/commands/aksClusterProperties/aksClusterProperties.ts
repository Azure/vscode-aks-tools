import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterARMResponse, determineClusterState, getAksClusterTreeItem, getClusterProperties, startCluster, stopCluster } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';
import { sleep } from '../utils/sleep';

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

    await prepareClusterProperties(cluster.result);
}

async function prepareClusterProperties(
  cloudTarget: AksClusterTreeItem
): Promise<void> {
  const clustername = cloudTarget.name;

  const clusterData = await longRunning(`Loading ${clustername} cluster properties.`, async () => await getClusterData(cloudTarget));
  if (failed(clusterData)) {
    vscode.window.showErrorMessage(clusterData.error);
    return;
  }

  const clusterState = await longRunning(`Determine ${clustername} cluster state.`, async () => await determineClusterState(cloudTarget, clustername));
  if (failed(clusterState)) {
      vscode.window.showErrorMessage(clusterState.error);
      return;
  }

  await loadWebViewClusterProperties(cloudTarget, clusterData.result, clusterState.result);
}

async function loadWebViewClusterProperties(
    cloudTarget: AksClusterTreeItem,
    clusterInfo: ClusterARMResponse,
    clusterStateResult: string
) {

    const clustername = cloudTarget.name;

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
      vscode.window.showErrorMessage(extensionPath.error);
      return;
    }

    await longRunning(`Loading webview ${clustername} for cluster properties.`,
      async () => {
        const webviewPanel = createWebView('AKS Cluster Properties', `AKS properties view for: ${clustername}`);
        const webview = webviewPanel.webview;

        webview.onDidReceiveMessage(
          async (message) => {
              const clusterData = await onReceivePerformOperations(cloudTarget, clustername, message.command, clusterStateResult);

              if (failed(clusterData)) {
                webviewPanel.dispose();
                vscode.window.showErrorMessage(clusterData.error);
                return;
              }

              const clusterState = await determineClusterState(cloudTarget, clustername);
              if (failed(clusterState)) {
                vscode.window.showErrorMessage(clusterState.error);
                return;
              }

              webview.html = getWebviewContent(clusterData.result, clusterState.result, extensionPath.result, webview);
          },
          undefined
      );

        webview.html = getWebviewContent(clusterInfo, clusterStateResult, extensionPath.result, webview);
      }
    );
}

async function getClusterData(
  cloudTarget: AksClusterTreeItem
): Promise<Errorable<ClusterARMResponse>> {

    return await longRunning(`Loading ${cloudTarget.name} cluster data.`,
      async () => {
        const clusterInfo = await getClusterProperties(cloudTarget, cloudTarget.name);
        return clusterInfo;
      }
    );
}

async function onReceivePerformOperations(
  cloudTarget: AksClusterTreeItem,
  clusterName: string,
  eventName: string,
  clusterState: string
): Promise<Errorable<ClusterARMResponse>> {

    let startStopClusterInfo: Errorable<string>;
    switch (eventName) {
      case 'startCluster':
            startStopClusterInfo = await longRunning(`Starting cluster.`, () => startCluster(cloudTarget, clusterName, clusterState) );
            break;
      case 'stopCluster':
            startStopClusterInfo = await longRunning(`Stopping cluster.`, () => stopCluster(cloudTarget, clusterName, clusterState));
            break;
      default:
            throw vscode.window.showErrorMessage(`Invalid ${eventName} triggered.`);
    }

    if (failed(startStopClusterInfo)) {
      return { succeeded: false, error: startStopClusterInfo.error };
    }
    // This delay is deliberate for previous action to kick-in,
    // without delay if we call load data it is consistent to get old data from RP.
    const clusterData = await longRunning(`Getting cluster data.`, async () => { await sleep(10000); return getClusterData(cloudTarget); });
    if (failed(clusterData)) {
      return { succeeded: false, error: clusterData.error };
    }
    return { succeeded: true, result: clusterData.result };

}

function getWebviewContent(
    clusterdata: ClusterARMResponse,
    clusterState: string,
    vscodeExtensionPath: string,
    webview: vscode.Webview
    ): string {
      const webviewClusterData = clusterdata?.properties;
      const styleUri = getResourceUri(webview, vscodeExtensionPath, 'common', 'detector.css');
      const templateUri = getResourceUri(webview, vscodeExtensionPath, 'aksclusterproperties', 'clusterproperties.html');
      const data = {
        cssuri: styleUri,
        name: clusterdata.name,
        clusterData: webviewClusterData,
        clusterState: clusterState
      };

      return getRenderedContent(templateUri, data);
  }
