import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMResponse, getDetectorInfo, getPortalUrl } from '../utils/detectors';
import { convertHtmlJsonConfiguration }  from './helpers/networkconnectivityhtmlhelper';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath, longRunning } from '../utils/host';
import { failed } from '../utils/errorable';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';

export default async function networkAndConnectivityDiagnostics(
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
      return undefined;
    }

    await loadNetworkConnectivityDetector(cluster.result, extensionPath.result);
}

async function loadNetworkConnectivityDetector(
  cloudTarget: AksClusterTreeItem,
  extensionPath: string) {
  const clustername = cloudTarget.name;

  await longRunning(`Loading ${clustername} diagnostics.`,
    async () => {
      const detectorInfo = await getDetectorInfo(cloudTarget, "networkconnectivity");
      if (failed(detectorInfo)) {
        vscode.window.showErrorMessage(detectorInfo.error);
        return;
      }

      const webview = createWebView('AKS Diagnostics', `AKS diagnostics view for: ${clustername}`);
      webview.html = getWebviewContent(detectorInfo.result, extensionPath);
    }
  );
}

function getWebviewContent(
  clusterdata: AppLensARMResponse,
  vscodeExtensionPath: string
): string {
  const webviewClusterData = clusterdata?.properties;
  const styleUri = getResourceUri(vscodeExtensionPath, 'common', 'detector.css');
  const templateUri = getResourceUri(vscodeExtensionPath, 'networkconnectivity', 'networkConnectivity.html');
  const data = {
    cssuri: styleUri,
    name: webviewClusterData.metadata.name,
    description: webviewClusterData.metadata.description,
    portalUrl: getPortalUrl(clusterdata),
    networkconfdata: webviewClusterData.dataset[0],
    allocatedoutdata: convertHtmlJsonConfiguration(webviewClusterData, 1),
    subnetdata: convertHtmlJsonConfiguration(webviewClusterData, 2),
    subneterrordata: convertHtmlJsonConfiguration(webviewClusterData, 3),
    domaindata: convertHtmlJsonConfiguration(webviewClusterData, 4)
  };

  return getRenderedContent(templateUri, data);
}
