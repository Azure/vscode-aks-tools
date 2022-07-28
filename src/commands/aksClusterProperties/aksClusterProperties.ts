import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterARMResponse, determineClusterState, getAksClusterTreeItem, getClusterProperties, startCluster, stopCluster } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { Errorable, failed } from '../utils/errorable';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, delay, getRenderedContent, getResourceUri } from '../utils/webviews';

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
  if (!clusterState) {
      return;
  }

  await loadWebViewClusterProperties(cloudTarget, clusterData.result, clusterState);
}

async function loadWebViewClusterProperties(
    cloudTarget: AksClusterTreeItem,
    clusterInfo: ClusterARMResponse,
    clusterState: string
) {

    const clustername = cloudTarget.name;

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
      vscode.window.showErrorMessage(extensionPath.error);
      return;
    }

    await longRunning(`Loading webview ${clustername} for cluster properties.`,
      async () => {
        let clusterData: ClusterARMResponse | undefined;
        const webview = createWebView('AKS Cluster Properties', `AKS properties view for: ${clustername}`);

        webview.onDidReceiveMessage(
          async (message) => {
              if (message.command === "startCluster") {
                clusterData = await onRecievePerformOperations(cloudTarget, clustername, 'start');
              } else if (message.command === "stopCluster") {
                clusterData = await onRecievePerformOperations(cloudTarget, clustername, 'stop');
              }
              const clusterState = await determineClusterState(cloudTarget, clustername);
              if (!clusterState || !clusterData) {
                  return;
              }
              webview.html = getWebviewContent(clusterData, clusterState, extensionPath.result);
          },
          undefined
      );

        webview.html = getWebviewContent(clusterInfo, clusterState, extensionPath.result);
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

async function onRecievePerformOperations(
  cloudTarget: AksClusterTreeItem,
  clusterName: string,
  eventName: string
): Promise<ClusterARMResponse | undefined> {

    let startStopClusterInfo: Errorable<string>;
    if (eventName === 'start') {
     startStopClusterInfo = await longRunning(`Starting cluster.`, () => startCluster(cloudTarget, clusterName) );
    } else {
      startStopClusterInfo = await longRunning(`Stopping cluster.`, () => stopCluster(cloudTarget, clusterName));
    }

    if (failed(startStopClusterInfo)) {
      vscode.window.showErrorMessage(startStopClusterInfo.error);
      return;
    }
    // This delay is deliberate for previous action to kick-in,
    // without delay if we call load data it is consistent to get old data from RP.
    await delay(10000);

    const clusterData = await getClusterData(cloudTarget);
    if (failed(clusterData)) {
      vscode.window.showErrorMessage(clusterData.error);
      return;
    }
    return clusterData.result;
}

function getWebviewContent(
    clusterdata: ClusterARMResponse,
    clusterState: string,
    vscodeExtensionPath: string
    ): string {
      const webviewClusterData = clusterdata?.properties;
      const styleUri = getResourceUri(vscodeExtensionPath, 'common', 'detector.css');
      const templateUri = getResourceUri(vscodeExtensionPath, 'aksclusterproperties', 'clusterproperties.html');
      const data = {
        cssuri: styleUri,
        name: clusterdata.name,
        clusterData: webviewClusterData,
        clusterState: clusterState
      };

      return getRenderedContent(templateUri, data);
  }
