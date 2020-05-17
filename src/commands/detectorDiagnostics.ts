import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMresponse } from './models/applensarmresponse';
import NetworkConnectivityHtmlHelper  from './helpers/networkconnectivityhtmlhelper';
import * as path from 'path';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import { Errorable } from './utils/errorable';
import ResourceManagementClient from 'azure-arm-resource/lib/resource/resourceManagementClient';

const meta = require('../../package.json');

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
                await loadNetworkConnectivityDetector(cloudTarget, extensionPath);
              }
        } else {
          vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

function getExtensionPath(): string | undefined {
  const publisherName = `${meta.publisher}.${meta.name}`;
  const vscodeExtensionPath = vscode.extensions.getExtension(publisherName)?.extensionPath;

  if (!vscodeExtensionPath) {
    vscode.window.showInformationMessage('No Extension path found.');
    return;
  }
  return vscodeExtensionPath;
}

async function loadNetworkConnectivityDetector(
  cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode,
  extensionPath: string) {
  const clsutername = cloudTarget.cloudResource.name;

  await longRunning(`Loading ${clsutername} diagnostics.`,
        async () => {
          const clusterAppLensData = await getAppLensDetectorData(cloudTarget);

          if (clusterAppLensData) {
            await createDetectorWebView(clsutername, clusterAppLensData, extensionPath);
          }
        }
    );
}

async function longRunning<T>(title: string, action: () => Promise<T>): Promise<T> {
  const options = {
      location: vscode.ProgressLocation.Notification,
      title: title
  };
  return await vscode.window.withProgress(options, (_) => action());
}

async function createDetectorWebView(
  clusterName: string,
  clusterAppLensData: AppLensARMresponse,
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
  clusterTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode
  ): Promise<AppLensARMresponse | undefined> {
  const apiResult = await getNetworkConnectivityInfo(clusterTarget);

  if (apiResult.succeeded) {
    return apiResult.result;
  } else if (!apiResult.succeeded) {
    vscode.window.showInformationMessage(apiResult.error);
  }
  return;
}

async function getNetworkConnectivityInfo(
  target: k8s.CloudExplorerV1.CloudExplorerResourceNode
  ): Promise<Errorable<AppLensARMresponse>> {
  try {
      const client = new ResourceManagementClient(target.cloudResource.root.credentials, target.cloudResource.root.subscriptionId);
      const resourceGroup = target.cloudResource.armId.split("/")[4];
      const networkConnectivityInfo = await client.resources.get(
        resourceGroup, target.cloudResource.resource.type,
        target.cloudResource.resource.name, "detectors", "networkconnectivity", "2019-08-01");

      return { succeeded: true, result: <AppLensARMresponse> networkConnectivityInfo};
    } catch (ex) {
      return { succeeded: false, error:  `Error invoking network connectivity detector: ${ex}` };
    }
}

function getWebviewContent(
  clusterdata: AppLensARMresponse,
  vscodeExtensionPath: string) {
    const webviewClusterData = clusterdata?.properties;

    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'src', 'commands', 'style', "networkconnectivity", 'networkConnectivity.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'src', 'commands', 'style', "networkconnectivity", 'networkConnectivity.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({scheme: 'vscode-resource'});
    const portalUrl = `https://ms.portal.azure.com/#@microsoft.onmicrosoft.com/resource/${clusterdata.id.split('detectors')[0]}aksDiagnostics`;

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();

    NetworkConnectivityHtmlHelper.htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = { cssuri: styleUri,
                   name: webviewClusterData.metadata.name,
                   description: webviewClusterData.metadata.description,
                   portalUrl: portalUrl,
                   networkconfdata: webviewClusterData.dataset[0],
                   allocatedoutdata: JSON.parse(NetworkConnectivityHtmlHelper.convertHtmlJsonConfiguration(webviewClusterData, 1)),
                   subnetdata: JSON.parse(NetworkConnectivityHtmlHelper.convertHtmlJsonConfiguration(webviewClusterData, 2)),
                   subneterrordata: JSON.parse(NetworkConnectivityHtmlHelper.convertHtmlJsonConfiguration(webviewClusterData, 3)),
                   domaindata: JSON.parse(NetworkConnectivityHtmlHelper.convertHtmlJsonConfiguration(webviewClusterData, 4))
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
