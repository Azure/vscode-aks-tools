import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { CloudExplorerV1 } from 'vscode-kubernetes-tools-api';

export async function configurePipeline(context: IActionContext, target: any): Promise<void | undefined> {
    const deployToAzureExtensionInstalled = await isDeployToAzureExtensionInstalled();
    if (!deployToAzureExtensionInstalled) {
        return undefined;
    }
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const configurePipelineCommand = 'configure-cicd-pipeline';
    if (!cloudExplorer.available) {
        return undefined;
    }
    const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);
    if (clusterTarget && clusterTarget.cloudName === "Azure" && clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster") {
        await executeDeployToAzureExtensionInstalled(configurePipelineCommand, clusterTarget);
    } else {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        return undefined;
    }

}

async function isDeployToAzureExtensionInstalled(): Promise<boolean> {
    const deployToAzureExtensionId = 'ms-vscode-deploy-azure.azure-deploy';
    const pipelinesExtension = vscode.extensions.getExtension(deployToAzureExtensionId);
    if (!pipelinesExtension) {
        vscode.window.showWarningMessage('Please install/enable `Deploy to Azure` extension and start again.');
        await vscode.commands.executeCommand('extension.open', deployToAzureExtensionId);
        return false;
    }
    return true;
}

async function executeDeployToAzureExtensionInstalled(commandToRun: string, cluster: any): Promise<void> {
    const listOfCommands = await vscode.commands.getCommands(true);
    if (listOfCommands.find((commmand: string) => commmand === commandToRun)) {
        try {
            vscode.commands.executeCommand(commandToRun, cluster);
        }
        catch (error) {
            vscode.window.showErrorMessage("Please report the issue with [Deploy to Azure extension](https://github.com/microsoft/vscode-deploy-azure/issues), execute command failed with error:" + error);
        }
    } else {
        vscode.window.showErrorMessage(`Unable to find command ${commandToRun}. Make sure Deploy to Azure extension is installed and enabled.`);
    }
}

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