import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from 'vscode-azureextensionui';
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
import { getExtensionPath, longRunning } from '../utils/host';
import {
    getWebviewContent,
    getKubectlGetOperatorsPod,
    applyCertManager,
    runASOIssuerCertYAML,
    getAzureServicePrincipal,
    applyAzureOperatorSettingsYAML,
    runASOInstallOperatorNameSpaceYaml,
    certManagerRolloutStatus
} from './helpers/azureservicehelper';
import * as clusters from '../utils/clusters';

export default async function azureServiceOperator(
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

            const cluster = clusterTarget.cloudResource as AksClusterTreeItem;
            const clusterKubeConfig = await clusters.getKubeconfigYaml(cluster);

            if (clusterKubeConfig) {
                await runAzureServiceOperator(cluster, clusterKubeConfig);
                clusterExplorer.api.refresh();
            }
        } else {
            vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        }
    }
}

async function runAzureServiceOperator(
    cloudTarget: AksClusterTreeItem,
    clusterKubeConfig: string
): Promise<void> {
    // 1) Azure Service Operator requires self-signed certificates for CRD Conversion Webhooks:
    //     * kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml

    const certManagerOutput = await longRunning(`Applying Cert Manager for Azure Service Operator.`,
        () => applyCertManager(clusterKubeConfig)
    );

    // 2) The cert-manager pods should be running before proceeding to the next step.
    const certManagerStatus = await longRunning(`Applying Cert Manager Rollout Status Check.`,
        () => certManagerRolloutStatus(clusterKubeConfig)
    );

    if (!certManagerStatus) return undefined;

    // 3) Install OLM is the pre-requisite of this work, using the apply YAML instructions here: https://github.com/operator-framework/operator-lifecycle-manager/releases/.
    // Also, page to refer: https://operatorhub.io/operator/azure-service-operator (Click Install button as top of the page)
    const settingOperatornamespaceOutput = await longRunning(`Applying Azure Service Operator Namespace.`,
        () => runASOInstallOperatorNameSpaceYaml(clusterKubeConfig)
    );

    if (!settingOperatornamespaceOutput) return undefined;

    // 3) IssuerCert apply with Operator namespace created above.
    const issuerOutput = await longRunning(`Applying Issuer Manager for Azure Service Operator.`,
        () => runASOIssuerCertYAML(clusterKubeConfig)
    );

    if (!issuerOutput) return undefined;

    // 4) Get Service Principal AppId and Password from user.
    const operatorSettingsObj = await longRunning(`Service Principal hook for Azure Service Operator.`,
        () => getAzureServicePrincipal(cloudTarget)
    );

    // 5) Use information for the following values to be supplied for OpeatorSetting Yaml:
    //      a) AZURE_TENANT_ID,
    //      b) AZURE_SUBSCRIPTION_ID,
    //      c) AZURE_CLIENT_ID,
    //      d) AZURE_CLIENT_SECRET,
    //      e) AZURE_CLOUD_ENV
    //         * Azure Environment value is used and "AzurePublicCloud" is default but provide AzureUSGovernmentCloud, AzureChinaCloud, AzureGermanCloud.
    // 5.1) Run kubectl apply for azureoperatorsettings.yaml
    if (!operatorSettingsObj) return undefined;

    const resultApplyASOSettings = await longRunning(`Service Principal hook for Azure Service Operator.`,
        () => applyAzureOperatorSettingsYAML(operatorSettingsObj, clusterKubeConfig)
    );

    if (!resultApplyASOSettings) return undefined;

    // 6) Final step: Get the azure service operator pod. - kubectl get pods -n operators
    const runResultGetOperatorPod = await longRunning(`Getting Azure Service Operator Pod.`,
        () => getKubectlGetOperatorsPod(clusterKubeConfig)
    );

    if (!runResultGetOperatorPod) return undefined;

    await createASOWebView(cloudTarget.name, certManagerOutput, issuerOutput, resultApplyASOSettings, runResultGetOperatorPod);
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
    panel.webview.html = getWebviewContent(clusterName, extensionPath, outputCertManagerResult, outputIssuerCertResult,
        outputASOSettingResult, outputResult);

}
