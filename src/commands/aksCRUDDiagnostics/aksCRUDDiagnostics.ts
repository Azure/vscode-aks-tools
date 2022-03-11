import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { getExtensionPath, longRunning }  from '../utils/host';
import { AppLensARMResponse, getAppLensDetectorData } from '../utils/detectors';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import path = require('path');
import { htmlHandlerRegisterHelper } from '../utils/detectorhtmlhelpers';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';

export default async function aksCRUDDiagnostics(
    context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
      const cloudTarget = cloudExplorer.api.resolveCommandTarget(target);

      if (cloudTarget && cloudTarget.cloudName === "Azure" &&
            cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
              const cluster = cloudTarget.cloudResource as AksClusterTreeItem;
              const extensionPath = getExtensionPath();
              if (extensionPath && cluster) {
                await loadDetector(cluster, extensionPath);
              }
        } else {
          vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function loadDetector(
    cloudTarget: AksClusterTreeItem,
    extensionPath: string) {
    const clustername = cloudTarget.name;

    await longRunning(`Loading ${clustername} diagnostics.`,
          async () => {
            const clusterAppLensData = await getAppLensDetectorData(cloudTarget, "aks-category-crud");
            const detectorMap = new Map();

            // Crud detector list is guranteed form the ARM call to aks-category-crud, under below data structure.
            const crudDetectorList = clusterAppLensData?.properties.dataset[0].renderingProperties.detectorIds;

            await Promise.all(crudDetectorList.map(async (detector: string) => {
              const detectorAppLensData = await getAppLensDetectorData(cloudTarget, detector);
              detectorMap.set(detector , detectorAppLensData);
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
