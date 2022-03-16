import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMResponse, getDetectorInfo } from '../utils/detectors';
import { convertHtmlJsonConfiguration }  from './helpers/networkconnectivityhtmlhelper';
import * as htmlhandlers from "handlebars";
import { htmlHandlerRegisterHelper } from '../utils/detectorhtmlhelpers';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath, longRunning } from '../utils/host';
import * as path from 'path';
import * as fs from 'fs';
import { failed } from '../utils/errorable';
import { createWebView } from '../utils/webviews';

export default async function networkAndConnectivityDiagnostics(
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
      await loadNetworkConnectivityDetector(cluster, extensionPath);
    }
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
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'common', 'detector.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'networkconnectivity', 'networkConnectivity.html'));
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
                   networkconfdata: webviewClusterData.dataset[0],
                   allocatedoutdata: convertHtmlJsonConfiguration(webviewClusterData, 1),
                   subnetdata: convertHtmlJsonConfiguration(webviewClusterData, 2),
                   subneterrordata: convertHtmlJsonConfiguration(webviewClusterData, 3),
                   domaindata: convertHtmlJsonConfiguration(webviewClusterData, 4)
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
