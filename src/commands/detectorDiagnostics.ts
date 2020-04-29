import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMresponse, AppLensAPIResult } from './models/applensarmresponse';
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
                await loadClusterInsights(cloudTarget, extensionPath);
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

async function loadClusterInsights(
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
  const apiResult = await getClusterInsightInfo(clusterTarget);

  if (apiResult.succeeded) {
    return apiResult.result.apiresult;
  } else if (!apiResult.succeeded) {
    vscode.window.showInformationMessage(apiResult.error);
  }
  return;
}

async function getClusterInsightInfo(
  target: k8s.CloudExplorerV1.CloudExplorerResourceNode
  ): Promise<Errorable<AppLensAPIResult>> {
  try {
      const client = new ResourceManagementClient(target.cloudResource.root.credentials, target.cloudResource.root.subscriptionId);
      const clusterInsightInfo = await client.resources.get(
        target.cloudResource.armId.split("/")[4], target.cloudResource.resource.type,
        target.cloudResource.resource.name, "detectors", "mcrEndpointUpdate", "2019-08-01");

      return { succeeded: true, result: {apiresult: <AppLensARMresponse> clusterInsightInfo}};
    } catch (ex) {
      return { succeeded: false, error:  `Error invoking cluster insight: ${ex}` };
    }
}

function getWebviewContent(
  clusterdata: AppLensARMresponse,
  vscodeExtensionPath: string) {
    const webviewClusterData = clusterdata?.properties;

    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'src', 'commands', 'style', 'detector.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'src', 'commands', 'style', 'detector.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({scheme: 'vscode-resource'});

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const template = htmlhandlers.compile(htmldata);
    const data = { "cssuri": `${styleUri}`,
                   "clustername": `${webviewClusterData.metadata.name}`,
                   "rowdata": `${webviewClusterData.dataset[0].table.rows[1][3].toString()}`,
                   "update": `${webviewClusterData.dataset[0].table.rows[0][2].toString()}`,
                   "rowdataupdate": `${webviewClusterData.dataset[0].table.rows[0][3].toString()}`,
                   "description": `${webviewClusterData.dataset[0].table.rows[1][2].toString()}`,
                   "rowdatadescription": `${webviewClusterData.dataset[0].table.rows[1][3].toString()}`,
                   "recommendedaction": `${webviewClusterData.dataset[0].table.rows[2][2].toString()}`,
                   "rowdatarecommendedaction": `${webviewClusterData.dataset[0].table.rows[2][3].toString()}`
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
