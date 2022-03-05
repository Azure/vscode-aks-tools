import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { configureStarterConfigDataForAKS } from './configureStarterWorkflowHelper';

export default async function configureStarterWorkflow(
    context: IActionContext,
    target: any
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);

    if (clusterTarget && clusterTarget.cloudName === "Azure" &&
        clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster" &&
        clusterExplorer.available) {

        const aksCluster = clusterTarget.cloudResource as AksClusterTreeItem;

        // Configure the starter workflow data.
        const aksStarterWorkflowData = configureStarterConfigDataForAKS(clusterTarget.cloudResource.armId.split("/")[4], aksCluster.name);

        // Display it to the end-user in their vscode editor.
        vscode.workspace.openTextDocument({
            content: aksStarterWorkflowData,
            language: "yaml"
          });
    } else {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
    }
}
