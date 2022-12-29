import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem, rotateClusterCert } from '../utils/clusters';
import { failed, succeeded } from '../utils/errorable';
import { longRunning } from '../utils/host';

export default async function aksRotateClusterCert(
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

  const answer = await vscode.window.showInformationMessage(`Do you want to rotate cluster ${clusterName} certificate?`, "Yes", "No");

  if (answer !== "Yes") {
    return;
  }

  if (answer === "Yes") {
    const result = await longRunning(`Rotating cluster certificate for ${clusterName}.`, async () => rotateClusterCert(cluster.result, clusterName) );

    if (failed(result)) {
      vscode.window.showErrorMessage(result.error);
    }

    if (succeeded(result)) {
      vscode.window.showInformationMessage(result.result);
    }
  }
}
