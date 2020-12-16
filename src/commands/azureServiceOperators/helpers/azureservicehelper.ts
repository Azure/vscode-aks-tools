import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionPath, longRunning } from '../../utils/host';
import { OperatorSettings } from '../models/operatorSettings';
import * as tmpfile from '../../utils/tempfile';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import { InstallationResponse } from '../models/installationResponse';
import * as clusters from '../../utils/clusters';
import { createASOWebView } from './azureservicehtmlhelper';
const tmp = require('tmp');

export async function startInstallation(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    kubectl: k8s.KubectlV1,
    installationResponse: InstallationResponse,
    aksCluster: AksClusterTreeItem,
    operatorSettingsInfo: OperatorSettings
) {

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

    createASOWebView(panel, extensionPath, installationResponse);
}

async function getOperatorsPod(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    const command = `get pods -n operators`;
    const failureDescription = "Get operator pod had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function installCertManager(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const cerManagerFile = "https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml";
    const command = `apply -f ${cerManagerFile}`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function checkCertManagerRolloutStatus(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const command = `rollout status -n cert-manager deploy/cert-manager-webhook`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function installOlmCrd(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const asoCrdYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/crds.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "yaml",
            (f) => kubectl.invokeCommand(`create -f ${asoCrdYamlFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager CRD resource had following error: ${e}`);
        return undefined;
    }
}

async function installOlm(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoOlmYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/olm.yaml";
    const command = `create -f ${asoOlmYamlFile}`;
    const failureDescription = "Installing operator lifecycle manager resource had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function installOperator(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoYamlFile = "https://operatorhub.io/install/azure-service-operator.yaml";
    const command = `create -f ${asoYamlFile}`;
    const failureDescription = "Installing operator resoruce had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function installIssuerCert(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const extensionPath = getExtensionPath();
    const templateYaml = tmp.fileSync({ prefix: "aso-issuer", postfix: `.yaml` });
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'issuerandcertmanager.yaml'));
    const issuerandcertmanager = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
    fs.writeFileSync(templateYaml.name, issuerandcertmanager);

    const command = `apply -f ${templateYaml.name}`;
    const failureDescription = "ASO Issuer and Cert Deployment file had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

async function installOperatorSettings(
    kubectl: k8s.KubectlV1,
    operatorSettingInfo: OperatorSettings,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const extensionPath = getExtensionPath();
    const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

    const azureoperatorsettings = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
        .replace("<TENANT_ID>", operatorSettingInfo.tenantId)
        .replace("<SUB_ID>", operatorSettingInfo.subId)
        .replace("<APP_ID>", operatorSettingInfo.appId)
        .replace("<CLIENT_SECRET>", operatorSettingInfo.clientSecret)
        .replace("<ENV_CLOUD>", operatorSettingInfo.cloudEnv);

    const templateYaml = tmp.fileSync({ prefix: "aso-operatorsettings", postfix: `.yaml` });
    fs.writeFileSync(templateYaml.name, azureoperatorsettings);

    const command = `apply -f ${templateYaml.name}`;
    const failureDescription = "Install operator settings had following error";
    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
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

async function invokeKubectlCommand(
    kubectl: k8s.KubectlV1,
    clusterKubeconfig: string,
    command: string,
    failureDescription: string,
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeconfig, "yaml",
            (f) => kubectl.invokeCommand(`${command} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`${failureDescription}: ${e}`);
        return undefined;
    }
}