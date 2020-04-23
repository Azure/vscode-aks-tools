import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { IAppLensARMresponse } from './models/iapplensarmresponse';
import * as path from 'path';
import * as fs from 'fs';
import * as htmlhandlers from "handlebars";

const meta = require('../../package.json');
const shelljs = require('shelljs');

export interface ShellResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export default async function detectorDiagnostics(
    context: IActionContext,
    target: any
  ): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
      const cloudTarget = await cloudExplorer.api.resolveCommandTarget(target);

      if (cloudTarget && cloudTarget.cloudName === "Azure" &&
            cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
              loadClusterInsights(cloudTarget);
        } else {
          vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

function loadClusterInsights(cloudTarget: k8s.CloudExplorerV1.CloudExplorerResourceNode) {
  const clsutername = cloudTarget.cloudResource.name;
  const armId = cloudTarget.cloudResource.armId;

  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Loading ${cloudTarget.cloudResource.name} diagnostics.`,
    cancellable: false
  }, () => {
    return new Promise(async (resolve) => {
      const clusterAppLensData = await getAppLensDetectorData(armId);

      if (clusterAppLensData) {
        await createDetectorWebView(clsutername, clusterAppLensData);
      }
      resolve();
    });
  });
}

async function createDetectorWebView(
  clusterName: string,
  clusterAppLensData: IAppLensARMresponse) {
    const panel = vscode.window.createWebviewPanel(
      'AKS Diagnostics',
      'AKS diagnostics view for: ' + clusterName,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableCommandUris: true
      }
    );

    panel.webview.html = getWebviewContent(clusterAppLensData, panel);
}

async function getAppLensDetectorData(clusterARMId: string): Promise<IAppLensARMresponse | undefined> {
  try {
    const appLensARMAPI = `az rest -m GET -u "${clusterARMId}/detectors/mcrEndpointUpdate?api-version=2019-08-01&executeChildren=true"`;

    const shellresult = exec(appLensARMAPI);
    const stdout = (await shellresult).stdout;
    const stderr = (await shellresult).stderr;

    if (stdout) {
      const appLensARMresponse = <IAppLensARMresponse> JSON.parse(stdout);
      return appLensARMresponse;
    } else if (stderr) {
      vscode.window.showInformationMessage(stderr);
    }
  } catch (err) {
    vscode.window.showInformationMessage('Error: ' + err);
    vscode.window.showInformationMessage('Selected Cluster has no data returned.');
  }
  return;
}

function exec(cmd: string, stdin?: string): Promise<ShellResult> {

  return new Promise<ShellResult>((resolve) => {
      const proc = shelljs.exec(cmd, (code: number, stdout: string, stderr: string) => resolve({ code: code, stdout: stdout, stderr: stderr }));
      if (stdin) {
          proc.stdin.end(stdin);
      }
  });
}

function getWebviewContent(
  clusterdata: IAppLensARMresponse,
  panel: vscode.WebviewPanel) {
    const webviewClusterData = clusterdata?.properties;
    const publisherName = `${meta.publisher}.${meta.name}`;
    const vscodeExtensionPath = vscode.extensions.getExtension(publisherName)?.extensionPath;

    if (!vscodeExtensionPath) {
      vscode.window.showErrorMessage("No Extension path");
      return "CSS file path missing";
    }

    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, "src/commands/style/detector.css"));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathToHtml = vscode.Uri.file(path.join(vscodeExtensionPath, "src/commands/style/detector.html"));
    const pathUri = pathToHtml.with({scheme: 'vscode-resource'});

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();

    const template = htmlhandlers.compile(htmldata);
    const data = { "cssuri": `${styleUri}`,
                     "clustername": `${webviewClusterData.metadata.name}`,
                     "rowdata": `${webviewClusterData.dataset[0].table.rows[1].toString().split(',')[3]}`
                  };
    const webviewcontent = template(data);

    return webviewcontent;
  }
