import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getWebviewContent,
    getKubectlGetOperatorsPod,
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

    // Get user input upfront.
    // Get Service Principal AppId and Password from user.
    const operatorSettingsInfo = await longRunning(`Getting Service Principal for Azure Service Operator...`,
        () => getAzureServicePrincipal(aksCluster)
    );

    if (!operatorSettingsInfo) return undefined;

    // 1) Azure Service Operator requires self-signed certificates for CRD Conversion Webhooks.
    const installCertManagerResult = await longRunning(`Installing Cert Manager for Azure Service Operator...`,
        () => installCertManager(kubectl, clusterKubeConfig)
    );

    // 2) The cert-manager pods should be running before proceeding to the next step.
    const certManagerStatus = await longRunning(`Checking Cert Manager Rollout Status...`,
        () => checkCertManagerRolloutStatus(kubectl, clusterKubeConfig)
    );

    if (!certManagerStatus) return undefined;

    // 3) Install OLM is the pre-requisite of this work, using the apply YAML instructions here: https://github.com/operator-framework/operator-lifecycle-manager/releases/.
    // Also, page to refer: https://operatorhub.io/operator/azure-service-operator (Click Install button as top of the page)
    const installOlmCrdResult = await longRunning(`Applying Operator Lifecycle Manager CRD resource...`,
        () => installOlmCrd(kubectl, clusterKubeConfig)
    );

    if (!installOlmCrdResult) return undefined;

    const installOlmResult = await longRunning(`Applying Operator Lifecycle Manager resource...`,
        () => installOlm(kubectl, clusterKubeConfig)
    );

    if (!installOlmResult) return undefined;

    const installOperatorResult = await longRunning(`Installing Opreator Namespace...`,
        () => installOperator(kubectl, clusterKubeConfig)
    );
    if (!installOperatorResult) return undefined;

    // 4) IssuerCert apply with Operator namespace created above.
    const installIssuerCertResult = await longRunning(`Creating the Issuer and Certificate cert-manager resources....`,
        () => installIssuerCert(kubectl, clusterKubeConfig)
    );

    if (!installIssuerCertResult) return undefined;

    // 5) Run kubectl apply for azureoperatorsettings.yaml
    const applyOperatorSettingsResult = await longRunning(`Creating Azure Service Operator Settings...`,
        () => installOperatorSettings(kubectl, operatorSettingsInfo, clusterKubeConfig)
    );

    if (!applyOperatorSettingsResult) return undefined;

    // 6) Final step: Get the azure service operator pod. - kubectl get pods -n operators
    const runResultGetOperatorPod = await longRunning(`Getting Azure Service Operator Pod...`,
        () => getKubectlGetOperatorsPod(kubectl, clusterKubeConfig)
    );

    if (!runResultGetOperatorPod) return undefined;

    await createASOWebView(aksCluster.name, installCertManagerResult, installIssuerCertResult, applyOperatorSettingsResult, runResultGetOperatorPod);
}

async function createASOWebView(
    clusterName: string,
    outputCertManagerResult: k8s.KubectlV1.ShellResult | undefined,
    outputIssuerCertResult: k8s.KubectlV1.ShellResult | undefined,
    outputASOSettingResult: k8s.KubectlV1.ShellResult | undefined,
    outputResult: k8s.KubectlV1.ShellResult | undefined
): Promise<void | undefined> {
    const panel = vscode.window.createWebviewPanel(
        `Azure Service Operator`,
        `Azure service Operator: ${clusterName}`,
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
        clusterName,
        extensionPath,
        outputCertManagerResult,
        outputIssuerCertResult,
        outputASOSettingResult,
        outputResult);
}
