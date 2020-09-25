import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { CloudExplorerV1 } from 'vscode-kubernetes-tools-api';

const deployToAzureExtensionId = 'ms-vscode-deploy-azure.azure-deploy';
const configurePipelineCommand = 'configure-cicd-pipeline';
const azurePortalUrl = 'https://ms.portal.azure.com/#@microsoft.onmicrosoft.com/';

export async function configurePipeline(context: IActionContext, target: any): Promise<void> {
    if (await isDeployToAzureExtensionInstalled()) {
        await getClusterAndExecute(target, configurePipelineCommand);
    }
}

export async function browsePipeline(context: IActionContext, target: any): Promise<void> {
    const deploymentCenterUrl: string = await getDeploymentCenterUrl(target);
    if (deploymentCenterUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(deploymentCenterUrl));
    } else {
        vscode.window.showErrorMessage(`Unable to browse pipelines for the resource. Select appropriate cluster.`);
    }

}

async function getDeploymentCenterUrl(target: any): Promise<string> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        const clusterTarget = cloudExplorer.api.resolveCommandTarget(target) as CloudExplorerV1.CloudExplorerResourceNode;
        if (clusterTarget) {
            return `${azurePortalUrl}resource${clusterTarget.cloudResource.id}/deloymentCenter`;
        }
    }
    return '';
}

async function getClusterAndExecute(target: any, command: string): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (!cloudExplorer.available) {
        return undefined;
    }
    const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);
    if (clusterTarget && clusterTarget.cloudName === "Azure" && clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster") {
        await executeDeployToAzureExtensionInstalled(command, clusterTarget);
    } else {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        return undefined;
    }

}

async function isDeployToAzureExtensionInstalled(): Promise<boolean> {
    const pipelinesExtension = vscode.extensions.getExtension(deployToAzureExtensionId);
    if (!pipelinesExtension) {
        vscode.window.showWarningMessage('Please install/enable `Deploy to Azure` extension and start again.');
        await vscode.commands.executeCommand('extension.open', deployToAzureExtensionId);
        return false;
    }
    return true;
}

async function executeDeployToAzureExtensionInstalled(commandToRun: string, cluster: any): Promise<void> {
    const listOfCommands = await vscode.commands.getCommands();
    if (listOfCommands.find((commmand: string) => commmand === commandToRun)) {
        return vscode.commands.executeCommand(commandToRun, cluster);
    }
    vscode.window.showErrorMessage(`Unable to find command ${commandToRun}. Make sure Deploy to Azure extension is installed and enabled.`);
}