import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { AppLensARMresponse } from './models/detectorAppLens';
import * as path from 'path';

const util = require('util');
const exec = util.promisify(require('child_process').exec);

export default async function detectorDiagnostics(
    context: IActionContext,
    target: any
  ): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
      const cloudTarget = await cloudExplorer.api.resolveCommandTarget(target);

      if (cloudTarget && cloudTarget.cloudName === "Azure" &&
            cloudTarget.nodeType === "resource" && cloudTarget.cloudResource.nodeType === "cluster") {
            const armId = cloudTarget.cloudResource.armId;
            // Get applens data
            const clusterAppLensData = await getAppLensDetectorData(armId);
            // Create webview
            await CreateDetectorWebView(target.value.name, clusterAppLensData);
        } else {
          vscode.window.showInformationMessage('Please select kubernetes cluster.');
        }
    }
}

async function CreateDetectorWebView(
  clusterName: string,
  clusterAppLensData: (AppLensARMresponse | void)) {

  if (clusterAppLensData) {
    vscode.window.showInformationMessage("Loading...");
    // Create webview
    const panel = vscode.window.createWebviewPanel(
      'AKS Diagnostics',
      'AKS diagnostics view for: ' + clusterName,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: true
      }
    );

    // Build webview from data.
    panel.webview.html = getWebviewContent(clusterAppLensData);
    vscode.window.showInformationMessage("AKS Diagnostics Completed.");
  } else {
    vscode.window.showInformationMessage('Selected Cluster has no data returned.');
  }
}

async function getAppLensDetectorData(clusterARMId: string): Promise<AppLensARMresponse | void> {
  // ARM api call.
  const appLensARMAPI = `az rest -m GET -u "${clusterARMId}/detectors/mcrEndpointUpdate?api-version=2019-08-01&executeChildren=true"`;
  const clusterAppLensData = await runAksShellCommand(appLensARMAPI);

  return clusterAppLensData;
}

async function runAksShellCommand(azcomand: string): Promise<AppLensARMresponse | void> {
  try {
    const { stdout } = await exec(azcomand);
    const appLensARMresponse = new AppLensARMresponse(JSON.parse(stdout));

    return appLensARMresponse;
  }catch (err) {
    vscode.window.showInformationMessage('Error: ' + err);
  }
}

function getWebviewContent(clusterdata: AppLensARMresponse) {
    const webviewClusterData = clusterdata?.properties;
    const vscodeExtensionPath = process.env.VSCODE_CWD;

    if (vscodeExtensionPath === undefined) {
      vscode.window.showErrorMessage("No Extension path");
      // TODO: context.extensionPath is missing at command level.
      return "CSS file path missing";
    }

    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, "src/commands/style/detector.css"));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });

    return `<!DOCTYPE html>
  <html lang="en">
  <!-- Link to the css file -->
  <link rel="stylesheet" href="${styleUri}">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title></title>
  </head>
  <body>
 
  <div class="panel with-nav-tabs panel-default app-container" _ngcontent-app-id-c0="">
  <div class="panel-body panel-body-withtab" id="app-content" _ngcontent-app-id-c0="">
  <div class="tab-content container-fluid panel-body-padding" _ngcontent-app-id-c0="">
  <generic-analysis class="ng-star-inserted" _nghost-app-id-c13="">
  <!----><detector-container class="ng-star-inserted" _ngcontent-app-id-c13="" _nghost-app-id-c14=""><!----><detector-control class="ng-star-inserted" _ngcontent-app-id-c14="" _nghost-app-id-c23=""><div class="outer-container" _ngcontent-app-id-c23="">
  <div class="control-container" _ngcontent-app-id-c23=""><!---->


  <!----></div></div></div>

  <!----></detector-control><div style="padding-top: 0px; padding-right: 20px; padding-left: 20px;" _ngcontent-app-id-c14=""><detector-view class="ng-tns-c24-1" _ngcontent-app-id-c14="" _nghost-app-id-c24=""><!----><div class="ng-tns-c24-1 ng-star-inserted" _ngcontent-app-id-c24=""><!----><div class="ng-tns-c24-1 ng-star-inserted" _ngcontent-app-id-c24=""><section class="content-header" _ngcontent-app-id-c24=""><h2 class="ng-tns-c24-1" _ngcontent-app-id-c24=""><!----><span class="span-h1 ng-tns-c24-1 ng-star-inserted" _ngcontent-app-id-c24="">Cluster Insights</span></h2><div class="description" _ngcontent-app-id-c24="">Identifies scenarios that may cause a cluster to no longer be manageable.</div><!----><!---->
  <div class="ng-tns-c24-1" style="margin-top:10px" _ngcontent-app-id-c24="">
  <div class="ng-tns-c24-1 ng-trigger ng-trigger-expand" style="height: 0px; overflow-y: hidden;" _ngcontent-app-id-c24=""><!----><!----></div></div></section><hr class="ng-tns-c24-1" _ngcontent-app-id-c24=""></div><!----></div><!----><!----><!----><!----></detector-view></div></detector-container><!---->

  <detector-list-analysis class="ng-tns-c15-0" _ngcontent-app-id-c13="" detectorparmname="detectorName" withindiagnoseandsolve="true" _nghost-app-id-c15="">
  <!----><!---->
  <div class="ng-tns-c15-0" _ngcontent-app-id-c15="">
  <!----><!---->
  <div class="list-wrapper ng-tns-c15-0 ng-star-inserted" _ngcontent-app-id-c15=""><div class="red-line remove-padding" _ngcontent-app-id-c15=""></div><!----><div class="list-item-wrapper ng-tns-c15-0 ng-star-inserted" _ngcontent-app-id-c15="">
  <div class="stepper-circle" _ngcontent-app-id-c15=""><i class="fa fa-search" aria-hidden="true" _ngcontent-app-id-c15=""></i></div><div class="list-item" _ngcontent-app-id-c15=""><div class="list-title" _ngcontent-app-id-c15="">
  Observations
  </div>
  <div class="ng-tns-c15-0" _ngcontent-app-id-c15="">Events observed during this time period</div>
  <!----><div class="list-text" _ngcontent-app-id-c15=""><!----><!---->
  <div class="table-responsive ng-tns-c15-0 ng-star-inserted" _ngcontent-app-id-c15="">
  <table class="table detector-list" _ngcontent-app-id-c15="">
  <thead class="ng-tns-c15-0" _ngcontent-app-id-c15=""><tr class="ng-tns-c15-0" _ngcontent-app-id-c15="">
  <th class="col-sm-2" _ngcontent-app-id-c15="">Issues</th>
  <th class="col-sm-6" _ngcontent-app-id-c15="">Description</th>
  <th class="col-sm-1" _ngcontent-app-id-c15="">Link</th></tr>
  </thead><tbody class="ng-tns-c15-0" _ngcontent-app-id-c15="">
  <!----><tr class="detector-insight ng-tns-c15-0 ng-star-inserted" _ngcontent-app-id-c15=""><td class="ng-tns-c15-0" _ngcontent-app-id-c15=""><div class="ng-tns-c15-0" style="white-space: nowrap" _ngcontent-app-id-c15=""><div class="ng-tns-c15-0" style="display: inline-block" _ngcontent-app-id-c15="">
  <status-icon class="ng-tns-c15-0" _ngcontent-app-id-c15="" _nghost-app-id-c17="">
  <div class="status-icon" _ngcontent-app-id-c17=""><!----><!---->
  <i class="fa fa-exclamation-triangle ng-star-inserted" style="color: rgb(255, 145, 4); font-size: 20px;" _ngcontent-app-id-c17=""></i></div>
  </status-icon></div>
  <div class="ng-tns-c15-0" style="display: inline-block;margin-left: 10px;" _ngcontent-app-id-c15="">
  <strong class="ng-tns-c15-0" _ngcontent-app-id-c15=""> ${webviewClusterData.metadata.name} </strong></div></div></td>

  <td class="ng-tns-c15-0" _ngcontent-app-id-c15=""> ${webviewClusterData.metadata.name}
  <div class="ng-tns-c15-0" style="margin-top:10px" _ngcontent-app-id-c15="">
  <markdown class="ng-tns-c15-0" _ngcontent-app-id-c15="" _nghost-app-id-c10="">
    <p>${webviewClusterData.dataset[0].table.rows[1].toString().split(',')[3]}
  </markdown></p>
</markdown></div></td><td class="ng-tns-c15-0" _ngcontent-app-id-c15="">
<div class="ng-tns-c15-0" style="margin-top: 5px;white-space: nowrap;" _ngcontent-app-id-c15="">
<a tabindex="0" class="ng-tns-c15-0" role="button" aria-label="More info for failed check - [Egress Breaking Change] Azure MCR has Updated its CDN endpoints" _ngcontent-app-id-c15="">More Info <i class="fa fa-arrow-circle-o-right" style="margin-left:5px; font-size: 15px" _ngcontent-app-id-c15=""></i></a></div></td></tr></tbody></table></div></div></div></div><!----><!----><!----><!----><!----><!----><div class="list-item-wrapper ng-tns-c15-0 ng-star-inserted" _ngcontent-app-id-c15="">
<div class="list-item" _ngcontent-app-id-c15="">
<div class="ng-tns-c15-0 remove-padding white-line" _ngcontent-app-id-c15=""></div>

</div></div></div><!----><!----><!----></div></detector-list-analysis><!----><div class="ng-star-inserted" hidden="" _ngcontent-app-id-c13=""><div _ngcontent-app-id-c13=""><div style="display: inline-block;margin-left: 20px" _ngcontent-app-id-c13=""><h2 _ngcontent-app-id-c13=""></h2></div><div style="display: inline-block;margin-left: 10px" _ngcontent-app-id-c13=""><!----></div></div><router-outlet _ngcontent-app-id-c13=""></router-outlet><generic-detector class="ng-star-inserted" _nghost-app-id-c28=""><div _ngcontent-app-id-c28=""><detector-container _nghost-app-id-c14="" _ngcontent-app-id-c28=""><!----><div style="padding-top: 0px; padding-right: 20px; padding-left: 20px;" _ngcontent-app-id-c14=""><detector-view class="ng-tns-c24-2" _ngcontent-app-id-c14="" _nghost-app-id-c24=""><!----><div class="ng-tns-c24-2 ng-star-inserted" _ngcontent-app-id-c24=""><!----><!----></div><!----><!----><!----><!----></detector-view></div></detector-container></div></generic-detector></div><!----><div class="cxp-chat-launcher-container align-width ng-star-inserted" _ngcontent-app-id-c13=""><!----></div></generic-analysis><genie-panel _nghost-app-id-c2=""><fab-panel _ngcontent-app-id-c2=""><span class="ms-layer"></span></fab-panel></genie-panel></div></div></div></TABS></SC-APP>
  </html>`;
  }
