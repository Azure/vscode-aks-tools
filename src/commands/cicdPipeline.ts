import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as utils from 'util';
import { IActionContext } from 'vscode-azureextensionui';

const deployToAzureExtensionId = 'ms-vscode-deploy-azure.azure-deploy';
const configurePipelineCommand = 'configure-cicd-pipeline';
const browsePipelineCommand = 'browse-cicd-pipeline';

export async function configurePipeline(context: IActionContext, target: any): Promise<void> {
    if (await isDeployToAzureExtensionInstalled()) {
        await getClusterAndExecute(target, configurePipelineCommand);
    }
}

export async function browsePipeline(context: IActionContext, target: any): Promise<void> {
    if (await isDeployToAzureExtensionInstalled()) {
        await getClusterAndExecute(target, browsePipelineCommand);
    }
}

async function getClusterAndExecute(target: any, command: string): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);
        if (clusterTarget && clusterTarget.cloudName === "Azure" && clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster") {
            await executeDeployToAzureExtensionInstalled(command, clusterTarget);
        } else {
            vscode.window.showInformationMessage('This command only applies to AKS clusters.');
            return;
        }
    } else {
        return;
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
    throw new Error(utils.format(`Unable to find command ${commandToRun}. Make sure Deploy to Azure extension is installed and enabled.`));
}