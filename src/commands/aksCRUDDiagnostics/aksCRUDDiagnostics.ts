import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { AppLensARMResponse, getDetectorInfo, getDetectorListData, getPortalUrl } from '../utils/detectors';
import { failed } from '../utils/errorable';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView, getRenderedContent, getResourceUri, HtmlHelper } from '../utils/webviews';

export default async function aksCRUDDiagnostics(
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
  
    await loadDetector(cluster.result, extensionPath.result);
}

async function loadDetector(
    cloudTarget: AksClusterTreeItem,
    extensionPath: string) {

    const clustername = cloudTarget.name;
    await longRunning(`Loading ${clustername} diagnostics.`,
      async () => {
        const detectorInfo = await getDetectorInfo(cloudTarget, "aks-category-crud");
        if (failed(detectorInfo)) {
          vscode.window.showErrorMessage(detectorInfo.error);
          return;
        }

        const detectorMap = await getDetectorListData(cloudTarget, detectorInfo.result);
        if (failed(detectorMap)) {
          vscode.window.showErrorMessage(detectorMap.error);
          return;
        }

        const webview = createWebView('AKS Diagnostics', `AKS diagnostics view for: ${clustername}`);
        webview.html = getWebviewContent(detectorInfo.result, detectorMap.result, extensionPath);
      }
    );
}

function getWebviewContent(
  clusterdata: AppLensARMResponse,
  detectorMap: Map<string, AppLensARMResponse>,
  vscodeExtensionPath: string
  ): string {
    const webviewClusterData = clusterdata?.properties;
    const styleUri = getResourceUri(vscodeExtensionPath, 'common', 'detector.css');
    const templateUri = getResourceUri(vscodeExtensionPath, 'akscrud', 'aksCRUD.html');
    const data = {
      cssuri: styleUri,
      name: webviewClusterData.metadata.name,
      description: webviewClusterData.metadata.description,
      portalUrl: getPortalUrl(clusterdata),
      detectorData: detectorMap
    };

    return getRenderedContent(templateUri, data, HtmlHelper.MarkdownLinkHelper | HtmlHelper.EachProperty | HtmlHelper.ToLowerCase);
}
