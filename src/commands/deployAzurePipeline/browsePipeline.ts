import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { CloudExplorerV1 } from 'vscode-kubernetes-tools-api';

export async function browsePipeline(context: IActionContext, target: any): Promise<void> {
    const deploymentCenterUrl = await getDeploymentCenterUrl(target);
    if (deploymentCenterUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(deploymentCenterUrl));
    } else {
        vscode.window.showErrorMessage(`Unable to browse pipelines for the resource. Select appropriate cluster.`);
    }
}

async function getDeploymentCenterUrl(target: any): Promise<string | undefined> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        const clusterTarget = cloudExplorer.api.resolveCommandTarget(target) as CloudExplorerV1.CloudExplorerResourceNode;
        if (clusterTarget) {
            return `https://portal.azure.com/#@${clusterTarget.cloudResource.session.tenantId}/resource${clusterTarget.cloudResource.id}/deloymentCenter`;
        }
    }
    return undefined;
}