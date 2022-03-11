import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMResponse, getAppLensDetectorData } from '../utils/detectors';
import { convertHtmlJsonConfiguration }  from './helpers/networkconnectivityhtmlhelper';
import * as htmlhandlers from "handlebars";
import { htmlHandlerRegisterHelper } from '../utils/detectorhtmlhelpers';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getExtensionPath, longRunning } from '../utils/host';
import path = require('path');
import * as fs from 'fs';

export default async function networkAndConnectivityDiagnostics(
    context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
      const cloudTarget = cloudExplorer.api.resolveCommandTarget(target);

      if (cloudTarget && cloudTarget.cloudName === "Azure" &&
            cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
              const extensionPath = getExtensionPath();
              if (extensionPath) {
                await loadNetworkConnectivityDetector(cloudTarget.cloudResource, extensionPath);
              }
        } else {
          vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function loadNetworkConnectivityDetector(
  cloudTarget: AksClusterTreeItem,
  extensionPath: string) {
  const clustername = cloudTarget.name;

  await longRunning(`Loading ${clustername} diagnostics.`,
        async () => {
          const clusterAppLensData = await getAppLensDetectorData(cloudTarget, "networkconnectivity");

          if (clusterAppLensData) {
            await createDetectorWebView(clustername, clusterAppLensData, extensionPath);
          }
        }
    );
}

async function createDetectorWebView(
  clusterName: string,
  clusterAppLensData: AppLensARMResponse,
  extensionPath: string) {
    const panel = vscode.window.createWebviewPanel(
      'AKS Diagnostics',
      'AKS diagnostics view for: ' + clusterName,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableCommandUris: true
      }
    );

    panel.webview.html = getWebviewContent(clusterAppLensData, extensionPath);
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
