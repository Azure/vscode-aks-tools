import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { startInstallation } from './helpers/azureservicehelper';
import {
    createASOWebViewPanel,
    convertAzureCloudEnv,
    createASOWebView
} from './helpers/azureservicehtmlhelper';
import * as clusters from '../utils/clusters';
import { InstallationResponse } from './models/installationResponse';
import { getExtensionPath } from '../utils/host';

export default async function installAzureServiceOperator(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

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
        await install(kubectl.api, aksCluster);
        clusterExplorer.api.refresh();
    } else {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
    }
}

export async function install(
    kubectl: k8s.KubectlV1,
    aksCluster: AksClusterTreeItem
): Promise<void> {
    const installationResponse: InstallationResponse = { clusterName: aksCluster.name };

    // getKubeconfigYaml handles reporting failure to the user, hence we dont need it here.
    const clusterKubeConfig = await clusters.getKubeconfigYaml(aksCluster);
    if (!clusterKubeConfig) return undefined;

    // Get user input upfront.
    // Get Service Principal AppId and Password from user.
    // Then start the installation process.
    const panel = createASOWebViewPanel(installationResponse);

    const extensionPath = getExtensionPath();

    if (!extensionPath) {
        return undefined;
    }

    // Create webview with user input required.
    createASOWebView(panel, extensionPath, installationResponse, true);

    // Once the submit for them webview is successfull we handle rest of the installation process for Azure Service Operator.
    panel.webview.onDidReceiveMessage(
        async (message) => {
            if (message.appid && message.password) {
                const inputAppIdBox = message.appid;
                const inputPasswordBox = message.password;
                const cloudName = convertAzureCloudEnv(aksCluster.root.environment.name);

                if (!inputAppIdBox || !inputPasswordBox) {
                    return undefined;
                }

                if (!cloudName) {
                    vscode.window.showWarningMessage(`Cloud environment name ${cloudName} is not supported.`);
                    return undefined;
                }

                const operatorSettingsInfo = {
                    tenantId: aksCluster.root.tenantId,
                    subId: aksCluster.subscription.subscriptionId!,
                    appId: inputAppIdBox,
                    clientSecret: inputPasswordBox,
                    cloudEnv: cloudName
                };

                const installationResponse: InstallationResponse = { clusterName: aksCluster.name };

                await startInstallation(panel, extensionPath, kubectl, installationResponse, aksCluster, operatorSettingsInfo);
            }
            return undefined;
        },
        undefined
    );
}
