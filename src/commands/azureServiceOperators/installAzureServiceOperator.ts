import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getWebviewContent,
    getOperatorsPod,
    installCertManager,
    installIssuerCert,
    getAzureServicePrincipal,
    installOperatorSettings,
    checkCertManagerRolloutStatus,
    installOlmCrd,
    installOlm,
    installOperator
} from './helpers/azureservicehelper';
import * as clusters from '../utils/clusters';
import { InstallationResponse } from './models/installationResponse';

export default async function installAzureServiceOperator(
    context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (cloudExplorer.available && kubectl.available) {
        const clusterTarget = cloudExplorer.api.resolveCommandTarget(target);

        if (clusterTarget && clusterTarget.cloudName === "Azure" &&
            clusterTarget.nodeType === "resource" && clusterTarget.cloudResource.nodeType === "cluster" &&
            clusterExplorer.available) {

            const aksCluster = clusterTarget.cloudResource as AksClusterTreeItem;
            const clusterKubeConfig = await clusters.getKubeconfigYaml(aksCluster);

            if (clusterKubeConfig) {
                await install(aksCluster, clusterKubeConfig);
                clusterExplorer.api.refresh();
            }
        } else {
            vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function install(
    aksCluster: AksClusterTreeItem,
    clusterKubeConfig: string
): Promise<void> {

    const kubectl = await k8s.extension.kubectl.v1;
    const installationResponse: InstallationResponse = { clusterName: aksCluster.name };
    // Get user input upfront.
    // Get Service Principal AppId and Password from user.
    const operatorSettingsInfo = await longRunning(`Getting Service Principal for Azure Service Operator...`,
        () => getAzureServicePrincipal(aksCluster)
    );

    if (!operatorSettingsInfo) return undefined;

    // 1) Azure Service Operator requires self-signed certificates for CRD Conversion Webhooks.
    installationResponse.installCertManagerResult = await longRunning(`Installing Cert Manager for Azure Service Operator...`,
        () => installCertManager(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installCertManagerResult, installationResponse))) return undefined;

    // 2) The cert-manager pods should be running before proceeding to the next step.
    installationResponse.checkCertManagerRolloutStatusResult = await longRunning(`Checking Cert Manager Rollout Status...`,
        () => checkCertManagerRolloutStatus(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.checkCertManagerRolloutStatusResult, installationResponse))) return undefined;

    // 3) Install OLM is the pre-requisite of this work, using the apply YAML instructions here: https://github.com/operator-framework/operator-lifecycle-manager/releases/.
    // Also, page to refer: https://operatorhub.io/operator/azure-service-operator (Click Install button as top of the page)
    installationResponse.installOlmCrdResult = await longRunning(`Installing Operator Lifecycle Manager CRD resource...`,
        () => installOlmCrd(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installOlmCrdResult, installationResponse))) return undefined;

    installationResponse.installOlmResult = await longRunning(`Installing Operator Lifecycle Manager resource...`,
        () => installOlm(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installOlmResult, installationResponse))) return undefined;

    installationResponse.installOperatorResult = await longRunning(`Installing Opreator Namespace...`,
        () => installOperator(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installOperatorResult, installationResponse))) return undefined;

    // 4) IssuerCert apply with Operator namespace created above.
    installationResponse.installIssuerCertResult = await longRunning(`Installing the Issuer and Certificate cert-manager resources....`,
        () => installIssuerCert(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installIssuerCertResult, installationResponse))) return undefined;

    // 5) Run kubectl apply for azureoperatorsettings.yaml
    installationResponse.installOperatorSettingsResult = await longRunning(`Installing Azure Service Operator Settings...`,
        () => installOperatorSettings(kubectl, operatorSettingsInfo, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.installOperatorSettingsResult, installationResponse))) return undefined;

    // 6) Final step: Get the azure service operator pod. - kubectl get pods -n operators
    installationResponse.getOperatorsPodResult = await longRunning(`Getting Azure Service Operator Pod...`,
        () => getOperatorsPod(kubectl, clusterKubeConfig)
    );
    if (!(await isInstallationSuccessfull(installationResponse.getOperatorsPodResult, installationResponse))) return undefined;

    await createASOWebView(installationResponse);
}

async function isInstallationSuccessfull(
    installationShellResult: k8s.KubectlV1.ShellResult | undefined,
    installationResponse: InstallationResponse
): Promise<boolean> {
    let success = true;

    if (!installationShellResult) return false;

    if (installationShellResult.code !== 0) {
        await createASOWebView(installationResponse);
        success = false;
    }

    return success;
}

async function createASOWebView(
    installationResponse: InstallationResponse
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
    panel.webview.html = getWebviewContent(
        installationResponse.clusterName,
        extensionPath,
        installationResponse);
}
