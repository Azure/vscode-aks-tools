import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import { resourceNode } from './models/resourceNode';
const CONFIGURE_PIPELINE_COMMAND = 'configure-cicd-pipeline';
const DEPLOY_TO_AZURE_EXTENSION_ID = 'ms-vscode-deploy-azure.azure-deploy';

export async function configurePipeline(context: IActionContext, target: any): Promise<void> {
    const deployToAzureExtensionInstalled = isDeployToAzureExtensionInstalled();
    if (deployToAzureExtensionInstalled) {
        const cloudExplorer = await k8s.extension.cloudExplorer.v1;
        if (cloudExplorer.available) {
            const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);
            if (clusterTarget && clusterTarget.cloudName === "Azure" && clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster") {
                const cluster = { resource: clusterTarget.cloudResource, subscriptionId: clusterTarget.cloudResource.subscription.subscriptionId };
                await executeDeployToAzureExtensionInstalled(CONFIGURE_PIPELINE_COMMAND, cluster);
            } else {
                vscode.window.showInformationMessage('This command only applies to AKS clusters.');
            }
        }
    } else {
        const installDeployToAzure = await vscode.window.showInformationMessage(
            '"Deploy to Azure" VSCode extension is needed for this command. Please install/enable the extension and try again.',
            "Open");
        if (installDeployToAzure === "Open") {
            await vscode.commands.executeCommand('extension.open', DEPLOY_TO_AZURE_EXTENSION_ID);
        }
    }
}

function isDeployToAzureExtensionInstalled(): boolean {
    const pipelinesExtension = vscode.extensions.getExtension(DEPLOY_TO_AZURE_EXTENSION_ID);
    if (!pipelinesExtension) {
        return false;
    }
    return true;
}

async function executeDeployToAzureExtensionInstalled(commandToRun: string, cluster: resourceNode): Promise<void> {
    const listOfCommands = await vscode.commands.getCommands(true);
    if (((listOfCommands)).includes(commandToRun)) {
        try {
            vscode.commands.executeCommand(commandToRun, cluster);
        }
        catch (error) {
            vscode.window.showErrorMessage("Command failed. Please report this issue with [Deploy to Azure extension](https://github.com/microsoft/vscode-deploy-azure/issues). Error details:" + error);
        }
    } else {
        vscode.window.showErrorMessage(`Unable to find command ${commandToRun}. Make sure Deploy to Azure extension is installed and enabled.`);
    }
}