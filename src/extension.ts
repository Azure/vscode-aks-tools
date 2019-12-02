import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as azcs from 'azure-arm-containerservice';  // deprecated, but @azure/arm-containerservice doesn't play nicely with AzureAccount, so...

import { parseResource } from './azure-api-utils';
import AksClusterTreeItem from './tree/AksClusterTreeItem';
import AzureAccountTreeItem from './tree/AzureAccountTreeItem';
import { createTelemetryReporter, registerUIExtensionVariables, AzExtTreeDataProvider, AzureUserInput, registerCommand } from 'vscode-azureextensionui';
import selectSubscriptions from './commands/selectSubscriptions';

export async function activate(context: vscode.ExtensionContext) {
    // NOTE: This is boilerplate configuration for the Azure UI extension on which this extension relies.
    const uiExtensionVariables = {
        context,
        ignoreBundle: !/^(false|0)?$/i.test(process.env.AZCODE_DOCKER_IGNORE_BUNDLE || ''),
        outputChannel: vscode.window.createOutputChannel('Azure Identity'),
        reporter: createTelemetryReporter(context),
        ui: new AzureUserInput(context.globalState)
    };

    context.subscriptions.push(uiExtensionVariables.outputChannel);

    registerUIExtensionVariables(uiExtensionVariables);

    registerCommand('aks.selectSubscriptions', selectSubscriptions);

    const azureAccountTreeItem = new AzureAccountTreeItem();
    context.subscriptions.push(azureAccountTreeItem);
    const treeDataProvider = new AzExtTreeDataProvider(azureAccountTreeItem, 'azureAks.loadMore');

    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        cloudExplorer.api.registerCloudProvider({
            cloudName: 'Azure',
            treeDataProvider,
            getKubeconfigYaml: getClusterKubeconfig
        });
    } else {
        vscode.window.showWarningMessage(cloudExplorer.reason);
    }
}

async function getClusterKubeconfig(target: AksClusterTreeItem): Promise<string | undefined> {
    const { resourceGroupName, name } = parseResource(target.id!);
    if (!resourceGroupName || !name) {
        vscode.window.showErrorMessage(`Invalid ARM id ${target.id}`);
        return;
    }
    const client = new azcs.ContainerServiceClient(target.root.credentials, target.root.subscriptionId);  // TODO: safely
    try {
        const accessProfile = await client.managedClusters.getAccessProfile(resourceGroupName, name, 'clusterUser');
        const kubeconfig = accessProfile.kubeConfig!.toString();  // TODO: safely
        return kubeconfig;
    } catch (e) {
        vscode.window.showErrorMessage(`Can't get kubeconfig: ${e}`);
        return undefined;
    }
}
