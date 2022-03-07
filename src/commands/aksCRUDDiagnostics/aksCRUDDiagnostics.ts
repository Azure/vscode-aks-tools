import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { getExtensionPath, longRunning }  from '../utils/host';
import { getAppLensDetectorData } from '../utils/detectors';
import { AppLensARMResponse } from '../detectorDiagnostics/models/applensarmresponse';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import path = require('path');
import { convertHtmlJsonConfiguration, htmlHandlerRegisterHelper } from '../detectorDiagnostics/helpers/networkconnectivityhtmlhelper';

export default async function aksCRUDDiagnostics(
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
                await loadDetector(cloudTarget.cloudResource, extensionPath);
                // vscode.window.showInformationMessage(`Do CRUD Detector ARM calls and fill web-view with return data: ${dataset}.`);
              }
        } else {
          vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function loadDetector(
    cloudTarget: any,
    extensionPath: string) {
    const clustername = cloudTarget.name;

    await longRunning(`Loading ${clustername} diagnostics.`,
          async () => {
            const clusterAppLensData = await getAppLensDetectorData(cloudTarget, "aks-category-crud");
            const detectorMap = new Map();

            await Promise.all(clusterAppLensData?.properties.dataset[0].renderingProperties.detectorIds.map(async (detector: string) => {
              const detectorAppLensData = await getAppLensDetectorData(cloudTarget, detector);
              detectorMap.set(detector , detectorAppLensData);
              detectorMap.get(detector);
            }));

            if (clusterAppLensData && detectorMap.size > 0) {
              await createDetectorWebView(clustername, clusterAppLensData, detectorMap, extensionPath);
            }
          }
      );
  }

async function createDetectorWebView(
  clusterName: string,
  clusterAppLensData: AppLensARMResponse,
  detectorMap: Map<string, AppLensARMResponse | undefined>,
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

    panel.webview.html = getWebviewContent(clusterAppLensData, detectorMap, extensionPath);
}

function getWebviewContent(
  clusterdata: AppLensARMResponse,
  detectorMap: Map<string, AppLensARMResponse | undefined>,
  vscodeExtensionPath: string
  ): string {
    const webviewClusterData = clusterdata?.properties;
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'akscrud', 'aksCRUD.css'));
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
                   detectorData: detectorMap,
                   detectorDataTest: convertHtmlJsonConfiguration(detectorMap.get("advisor-available-ips")?.properties, 1),
                  //  subnetdata: convertHtmlJsonConfiguration(webviewClusterData, 2),
                  //  subneterrordata: convertHtmlJsonConfiguration(webviewClusterData, 3),
                  //  domaindata: convertHtmlJsonConfiguration(webviewClusterData, 4)
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
