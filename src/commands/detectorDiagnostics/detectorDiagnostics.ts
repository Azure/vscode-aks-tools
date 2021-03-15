import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMResponse } from './models/applensarmresponse';
import { convertHtmlJsonConfiguration, htmlHandlerRegisterHelper }  from './helpers/networkconnectivityhtmlhelper';
import { longRunning, getExtensionPath }  from '../utils/host';
import * as path from 'path';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import { Errorable } from '../utils/errorable';
import { ResourceManagementClient } from '@azure/arm-resources';

export default async function detectorDiagnostics(
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
  cloudTarget: any,
  extensionPath: string) {
  const clustername = cloudTarget.name;

  await longRunning(`Loading ${clustername} diagnostics.`,
        async () => {
          const clusterAppLensData = await getAppLensDetectorData(cloudTarget);

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

async function getAppLensDetectorData(
  clusterTarget: any
  ): Promise<AppLensARMResponse | undefined> {
  const apiResult = await getNetworkConnectivityInfo(clusterTarget);

  if (apiResult.succeeded) {
    return apiResult.result;
  } else {
    vscode.window.showInformationMessage(apiResult.error);
  }
  return undefined;
}

async function getNetworkConnectivityInfo(
  target: any
  ): Promise<Errorable<AppLensARMResponse>> {
  try {
      const client = new ResourceManagementClient(target.root.credentials, target.root.subscriptionId);
      // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
      const resourceGroup = target.armId.split("/")[4];
      const networkConnectivityInfo = await client.resources.get(
        resourceGroup, target.resource.type,
        target.resource.name, "detectors", "networkconnectivity", "2019-08-01");

      return { succeeded: true, result: <AppLensARMResponse> networkConnectivityInfo};
    } catch (ex) {
      return { succeeded: false, error:  `Error invoking network connectivity detector: ${ex}` };
    }
}

function getWebviewContent(
  clusterdata: AppLensARMResponse,
  vscodeExtensionPath: string
  ): string {
    const webviewClusterData = clusterdata?.properties;
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'networkconnectivity', 'networkConnectivity.css'));
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
