import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { getAksClusterTreeItem } from '../utils/clusters';
import { configureStarterConfigDataForAKS } from '../utils/configureWorkflowHelper';
import { failed } from '../utils/errorable';

export default async function configureHelmStarterWorkflow(
    _context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    // Configure the starter workflow data.
    const aksStarterWorkflowData = configureStarterConfigDataForAKS(cluster.result.armId.split("/")[4], cluster.result.name, "azure-kubernetes-service-helm");
    if (failed(aksStarterWorkflowData)) {
        vscode.window.showErrorMessage(aksStarterWorkflowData.error);
        return;
    }

    // Display it to the end-user in their vscode editor.
    vscode.workspace.openTextDocument({
        content: aksStarterWorkflowData.result,
        language: "yaml"
    });
}
