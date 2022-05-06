import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from "vscode-azureextensionui";
import { getAksClusterTreeItem } from '../utils/clusters';
import { getExtensionPath }  from '../utils/host';
import { failed } from '../utils/errorable';

export default async function aksNavToPortal(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
      vscode.window.showErrorMessage(cluster.error);
      return;
    }

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
      vscode.window.showErrorMessage(extensionPath.error);
      return;
    }

    vscode.env.openExternal(vscode.Uri.parse(`https://portal.azure.com/#resource${target.value.id}/overview`));
}
