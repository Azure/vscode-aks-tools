import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { getAksClusterTreeItem } from '../utils/clusters';
import { configureStarterConfigDataForAKS } from './configureStarterWorkflowHelper';

export default async function configureStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (cluster === undefined) {
        return;
    }

    // Configure the starter workflow data.
    const aksStarterWorkflowData = configureStarterConfigDataForAKS(cluster.armId.split("/")[4], cluster.name);

    // Display it to the end-user in their vscode editor.
    vscode.workspace.openTextDocument({
        content: aksStarterWorkflowData,
        language: "yaml"
    });
}
