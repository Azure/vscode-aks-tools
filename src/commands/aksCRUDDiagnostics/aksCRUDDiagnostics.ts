import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath, longRunning }  from '../utils/host';
import { AppLensARMResponse, getDetectorInfo, getDetectorListData } from '../utils/detectors';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import path = require('path');
import { htmlHandlerRegisterHelper } from '../utils/detectorhtmlhelpers';
import { failed } from '../utils/errorable';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { createWebView } from '../utils/webviews';

export default async function aksCRUDDiagnostics(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (cluster === undefined) {
      return;
    }

    const extensionPath = getExtensionPath();
    if (extensionPath) {
      await loadDetector(cluster, extensionPath);
    }
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
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'common', 'detector.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'akscrud', 'aksCRUD.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({scheme: 'vscode-resource'});
    const portalUrl = `https://portal.azure.com/#resource${clusterdata.id.split('detectors')[0]}aksDiagnostics`;

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
                   cssuri: styleUri,
                   name: webviewClusterData.metadata.name,
                   description: webviewClusterData.metadata.description,
                   portalUrl: portalUrl,
                   detectorData: detectorMap
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
