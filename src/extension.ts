import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as azcs from 'azure-arm-containerservice';  // deprecated, but @azure/arm-containerservice doesn't play nicely with AzureAccount, so...

import { AKSTreeProvider, AKSClusterTreeNode } from './aks-tree';
import { parseResource } from './azure-api-utils';
import AksClusterTreeItem from './tree/AksClusterTreeItem';
import { AzureAccountTreeItem } from './tree/AzureAccountTreeItem';
import { createTelemetryReporter, registerUIExtensionVariables, AzExtTreeDataProvider, AzureUserInput, registerCommand } from 'vscode-azureextensionui';
import selectSubscriptions from './commands/selectSubscriptions';

const explorer = new AKSTreeProvider();

export async function activate(context: vscode.ExtensionContext) {
    const ext = {
        context,
        ignoreBundle: !/^(false|0)?$/i.test(process.env.AZCODE_DOCKER_IGNORE_BUNDLE || ''),
        outputChannel: vscode.window.createOutputChannel('Azure Identity'),
        reporter: createTelemetryReporter(context),
        ui: new AzureUserInput(context.globalState)
    };

    context.subscriptions.push(ext.outputChannel);

    registerUIExtensionVariables(ext);

    registerCommand('aks.selectSubscriptions', selectSubscriptions);

    const azureAccountTreeItem = new AzureAccountTreeItem();
    context.subscriptions.push(azureAccountTreeItem);
    const treeDataProvider = new AzExtTreeDataProvider(azureAccountTreeItem, 'azureAks.loadMore');

    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        cloudExplorer.api.registerCloudProvider({
            cloudName: 'Azure',
            treeDataProvider: explorer,
            getKubeconfigYaml: getClusterKubeconfig
        });
        cloudExplorer.api.registerCloudProvider({
            cloudName: 'Azure (v2)',
            treeDataProvider,
            getKubeconfigYaml: getClusterKubeconfigV2
        });
    } else {
        vscode.window.showWarningMessage(cloudExplorer.reason);
    }
}

async function getClusterKubeconfig(target: AKSClusterTreeNode): Promise<string | undefined> {
    const { resourceGroupName, name } = parseResource(target.armId);
    if (!resourceGroupName || !name) {
        vscode.window.showErrorMessage(`Invalid ARM id ${target.armId}`);
        return;
    }
    const client = new azcs.ContainerServiceClient(target.session.credentials, target.subscription.subscriptionId!);  // TODO: safely
    try {
        const accessProfile = await client.managedClusters.getAccessProfile(resourceGroupName, name, 'clusterUser');
        const kubeconfig = accessProfile.kubeConfig!.toString();  // TODO: safely
        return kubeconfig;
    } catch (e) {
        vscode.window.showErrorMessage(`Can't get kubeconfig: ${e}`);
        return undefined;
    }
}

async function getClusterKubeconfigV2(target: AksClusterTreeItem): Promise<string | undefined> {
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
