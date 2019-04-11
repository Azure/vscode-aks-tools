import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as azcs from 'azure-arm-containerservice';  // deprecated, but @azure/arm-containerservice doesn't play nicely with AzureAccount, so...

import { AKSTreeProvider, AKSClusterTreeNode } from './aks-tree';
import { parseResource } from './azure-api-utils';

const explorer = new AKSTreeProvider();

export async function activate(context: vscode.ExtensionContext) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    if (cloudExplorer.available) {
        cloudExplorer.api.registerCloudProvider({
            cloudName: "Azure",
            treeDataProvider: explorer,
            getKubeconfigYaml: getClusterKubeconfig
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
