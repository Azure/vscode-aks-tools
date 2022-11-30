import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { startInstallation } from './helpers/azureservicehelper';
import {
    convertAzureCloudEnv,
    createASOWebView
} from './helpers/azureservicehtmlhelper';
import { InstallationResponse } from './models/installationResponse';
import { getAksClusterTreeItem, getClusterProperties, getKubeconfigYaml } from '../utils/clusters';
import { getExtensionPath, longRunning } from '../utils/host';
import { createWebView } from '../utils/webviews';
import { failed } from '../utils/errorable';

export default async function installAzureServiceOperator(
    _context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return undefined;
    }

    await install(kubectl.api, cluster.result);
    clusterExplorer.api.refresh();
}

export async function install(
    kubectl: k8s.KubectlV1,
    aksCluster: AksClusterTreeItem
): Promise<void> {
    const installationResponse: InstallationResponse = { clusterName: aksCluster.name };

    const properties = await longRunning(`Getting properties for cluster ${aksCluster.name}.`, () => getClusterProperties(aksCluster));
    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return undefined;
    }

    const kubeconfig = await longRunning(`Retrieving kubeconfig for cluster ${aksCluster.name}.`, () => getKubeconfigYaml(aksCluster, properties.result));
    if (failed(kubeconfig)) {
        vscode.window.showErrorMessage(kubeconfig.error);
        return undefined;
    }

    // Get user input upfront.
    // Get Service Principal AppId and Password from user.
    // Then start the installation process.
    const webview = createWebView('Azure Service Operator', `Azure service Operator: ${installationResponse.clusterName}`).webview;

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return undefined;
    }

    // Create webview with user input required.
    createASOWebView(webview, extensionPath.result, installationResponse, true);

    // Once the submit for them webview is successfull we handle rest of the installation process for Azure Service Operator.
    webview.onDidReceiveMessage(
        async (message) => {
            if (message.appid && message.password) {
                const cloudName = convertAzureCloudEnv(aksCluster.subscription.environment.name);

                if (!cloudName) {
                    vscode.window.showWarningMessage(`Cloud environment name ${cloudName} is not supported.`);
                    return undefined;
                }

                const operatorSettingsInfo = {
                    tenantId: aksCluster.subscription.tenantId,
                    subId: aksCluster.subscription.subscriptionId!,
                    appId: message.appid,
                    clientSecret: message.password,
                    cloudEnv: cloudName
                };

                const installationResponse: InstallationResponse = { clusterName: aksCluster.name };

                await startInstallation(webview, extensionPath.result, kubectl, installationResponse, kubeconfig.result, operatorSettingsInfo);
            }
            return undefined;
        },
        undefined
    );
}
