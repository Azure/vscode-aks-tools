import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { abortLastOperationInCluster, determineProvisioningState, getAksClusterTreeItem } from '../utils/clusters';
import { failed, succeeded } from '../utils/errorable';
import { longRunning } from '../utils/host';

export default async function aksAbortLastOperation(
  _context: IActionContext,
  target: any
): Promise<void> {
  const cloudExplorer = await k8s.extension.cloudExplorer.v1;

  const cluster = getAksClusterTreeItem(target, cloudExplorer);
  if (failed(cluster)) {
    vscode.window.showErrorMessage(cluster.error);
    return;
  }

  const clusterName = cluster.result.name;
  
  const clusterProvisioingState = await determineProvisioningState(cluster.result, clusterName);
  if (failed(clusterProvisioingState)) {
    vscode.window.showErrorMessage(clusterProvisioingState.error);
    return;
  }

  if (clusterProvisioingState.result === "Succeeded" || clusterProvisioingState.result === "Canceled") {
    vscode.window.showInformationMessage(`Cluster provisioning state is ${clusterProvisioingState.result} and there is no operation to abort.`);
    return;
  }
  const answer = await vscode.window.showInformationMessage(`Do you want to abort last operation in cluster ${clusterName}?`, "Yes", "No");

  if (answer === "Yes") {
    const result = await longRunning(`Aborting last cluster operation in ${clusterName}.`, async () => { return await abortLastOperationInCluster(cluster.result, clusterName) });

    if (failed(result)) {
      vscode.window.showErrorMessage(result.error);
    }

    if (succeeded(result)) {
      vscode.window.showInformationMessage(result.result);
    }
  }
}
