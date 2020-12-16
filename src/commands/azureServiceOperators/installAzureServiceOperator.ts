import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import {
    getOperatorsPod,
    installCertManager,
    installIssuerCert,
    installOperatorSettings,
    checkCertManagerRolloutStatus,
    installOlmCrd,
    installOlm,
    installOperator } from './helpers/azureservicehelper';
import {
    convertAzureCloudEnv,
    createASOWebView } from './helpers/azureservicehtmlhelper';
import * as clusters from '../utils/clusters';
import { InstallationResponse } from './models/installationResponse';
import { getExtensionPath, longRunning } from '../utils/host';

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
    await getUserInputAndInstallASO(kubectl, installationResponse, aksCluster, true);
}

export async function getUserInputAndInstallASO(
    kubectl: k8s.KubectlV1,
    installationResponse: InstallationResponse,
    aksCluster: AksClusterTreeItem,
    getUserInput = false
): Promise<void | undefined> {
    const panel = vscode.window.createWebviewPanel(
        `Azure Service Operator`,
        `Azure service Operator: ${installationResponse.clusterName}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    const extensionPath = getExtensionPath();

    if (!extensionPath) {
        return undefined;
    }

    // For the case of successful run of the tool we render webview with the output information.
    await createASOWebView(panel, extensionPath, installationResponse, getUserInput);

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

                // getKubeconfigYaml handles reporting failure to the user, hence we dont need it here.
                const clusterKubeConfig = await clusters.getKubeconfigYaml(aksCluster);
                if (!clusterKubeConfig) return undefined;

                // 1) Azure Service Operator requires self-signed certificates for CRD Conversion Webhooks.
                installationResponse.installCertManagerResult = await longRunning(`Installing Cert Manager for Azure Service Operator...`,
                    () => installCertManager(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.installCertManagerResult, installationResponse))) return undefined;

                // 2) The cert-manager pods should be running before proceeding to the next step.
                installationResponse.checkCertManagerRolloutStatusResult = await longRunning(`Checking Cert Manager Rollout Status...`,
                    () => checkCertManagerRolloutStatus(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.checkCertManagerRolloutStatusResult, installationResponse))) return undefined;

                // 3) Install OLM is the pre-requisite of this work, using the apply YAML instructions here: https://github.com/operator-framework/operator-lifecycle-manager/releases/.
                // Also, page to refer: https://operatorhub.io/operator/azure-service-operator (Click Install button as top of the page)
                installationResponse.installOlmCrdResult = await longRunning(`Installing Operator Lifecycle Manager CRD resource...`,
                    () => installOlmCrd(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.installOlmCrdResult, installationResponse))) return undefined;

                installationResponse.installOlmResult = await longRunning(`Installing Operator Lifecycle Manager resource...`,
                    () => installOlm(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.installOlmResult, installationResponse))) return undefined;

                installationResponse.installOperatorResult = await longRunning(`Installing Opreator Namespace...`,
                    () => installOperator(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.installOperatorResult, installationResponse))) return undefined;

                // 4) IssuerCert apply with Operator namespace created above.
                installationResponse.installIssuerCertResult = await longRunning(`Installing the Issuer and Certificate cert-manager resources....`,
                    () => installIssuerCert(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.installIssuerCertResult, installationResponse))) return undefined;

                // 5) Run kubectl apply for azureoperatorsettings.yaml
                installationResponse.installOperatorSettingsResult = await longRunning(`Installing Azure Service Operator Settings...`,
                    () => installOperatorSettings(kubectl, operatorSettingsInfo, clusterKubeConfig)
                );
                if (!isInstallationSuccessfull(panel, extensionPath, installationResponse.installOperatorSettingsResult, installationResponse)) return undefined;

                // 6) Final step: Get the azure service operator pod. - kubectl get pods -n operators
                installationResponse.getOperatorsPodResult = await longRunning(`Getting Azure Service Operator Pod...`,
                    () => getOperatorsPod(kubectl, clusterKubeConfig)
                );
                if (!(isInstallationSuccessfull(panel, extensionPath, installationResponse.getOperatorsPodResult, installationResponse))) return undefined;

                await createASOWebView(panel, extensionPath, installationResponse);
            }
            return undefined;
        },
        undefined
    );
}

function isInstallationSuccessfull(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    installationShellResult: k8s.KubectlV1.ShellResult | undefined,
    installationResponse: InstallationResponse
): boolean {
    let success = true;

    if (!installationShellResult) return false;

    if (installationShellResult.code !== 0) {
        createASOWebView(panel, extensionPath, installationResponse);
        success = false;
    }

    return success;
}
