import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionPath } from '../../utils/host';
import { OperatorSettings } from '../models/operatorSettings';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';
import { InstallationResponse } from '../models/installationResponse';
const tmp = require('tmp');

export async function getAzureServicePrincipal(
    aksCluster: AksClusterTreeItem
): Promise<OperatorSettings | undefined> {

    const optionsAppId: vscode.InputBoxOptions = {
        prompt: "Enter AppId of Service Principal, the ServicePrincipal you pass to the command below needs to have access to create resources in your subscription. More: https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli",
        placeHolder: "Enter App ID of service principal: e.g.(Sample) 041ccd53-e72f-45d1-bbff-382c82f6f9a1",
        ignoreFocusOut: true
    };
    const optionsPassword: vscode.InputBoxOptions = {
        prompt: "Enter Password for the Service Principal, the ServicePrincipal you pass to the command below needs to have access to create resources in your subscription. More: https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli",
        placeHolder: "Enter Password of Service Principal",
        ignoreFocusOut: true
    };

    const inputAppIdBox = await vscode.window.showInputBox(optionsAppId);
    const inputPasswordBox = await vscode.window.showInputBox(optionsPassword);
    const cloudName = convertAzureCloudEnv(aksCluster.root.environment.name);

    if (!inputAppIdBox || !inputPasswordBox) {
        return undefined;
    }

    if (!cloudName) {
        vscode.window.showWarningMessage(`Cloud environment name ${cloudName} is not supported.`);
        return undefined;
    }

    return {
        tenantId: aksCluster.root.tenantId,
        subId: aksCluster.subscription.subscriptionId!,
        appId: inputAppIdBox,
        clientSecret: inputPasswordBox,
        cloudEnv: cloudName
    };
}

export async function getOperatorsPod(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    const command = `get pods -n operators`;
    const failureDescription = "Get operator pod had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installCertManager(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const cerManagerFile = "https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml";
    const command = `apply -f ${cerManagerFile}`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function checkCertManagerRolloutStatus(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const command = `rollout status -n cert-manager deploy/cert-manager-webhook`;
    const failureDescription = "Cert Manager Rollout had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installOlmCrd(
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

export async function installOlm(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoOlmYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/olm.yaml";
    const command = `create -f ${asoOlmYamlFile}`;
    const failureDescription = "Installing operator lifecycle manager resource had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installOperator(
    kubectl: k8s.KubectlV1,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    const asoYamlFile = "https://operatorhub.io/install/azure-service-operator.yaml";
    const command = `create -f ${asoYamlFile}`;
    const failureDescription = "Installing operator resoruce had following error";

    const result = await invokeKubectlCommand(kubectl, clusterKubeConfig, command, failureDescription);
    return result;
}

export async function installIssuerCert(
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

export async function installOperatorSettings(
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

function convertAzureCloudEnv(cloudName: string): string | undefined {
    // Cloud env map: https://docs.microsoft.com/en-us/azure/storage/common/storage-powershell-independent-clouds#get-endpoint-using-get-azenvironment
    if (cloudName === "AzureUSGovernment") {
        return "AzureUSGovernmentCloud";
    }
    if (cloudName === "AzureChinaCloud") {
        return "AzureChinaCloud";
    }
    if (cloudName === "AzureGermanCloud") {
        return "AzureGermanCloud";
    }
    if (cloudName === "AzureCloud") {
        return "AzurePublicCloud";
    }

    return undefined;
}

interface InstallResult {
    succeeded?: boolean;  // used for how to format the main message
    mainMessage?: string;  // the "it installed" or "it failed" message
    logs?: LogSection[];  // the logs
}

interface LogSection {
    title?: string;
    messages?: string;
}

export function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    installationResponse: InstallationResponse
): string {
    const stylePathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const installHtmlResult = getOrganisedInstallResult(clustername, installationResponse);

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        name: clustername,
        mainMessage: installHtmlResult.mainMessage,
        resultLogs: installHtmlResult.logs,
        isSuccess: installHtmlResult.succeeded
    };
    const webviewcontent = template(data);

    return webviewcontent;
}

function getOrganisedInstallResult(
    clustername: string,
    installationResponse: InstallationResponse
) {
    const installResults: InstallResult = {};
    const certManagerResult = installationResponse.installCertManagerResult;
    const certManagerSatatusResult = installationResponse.checkCertManagerRolloutStatusResult;
    const issuerCertResult = installationResponse.installIssuerCertResult;
    const olmCrdResult = installationResponse.installOlmCrdResult;
    const olmResult = installationResponse.installOlmResult;
    const operatorResult = installationResponse.installOperatorSettingsResult;
    const operatorSettingsResult = installationResponse.installOperatorResult;
    const getOperatorsPodResult = installationResponse.getOperatorsPodResult;

    const installResultCollection = [certManagerResult, certManagerSatatusResult, issuerCertResult, olmCrdResult,
        olmResult, operatorResult, operatorSettingsResult, getOperatorsPodResult];
    installResults.succeeded = installationExitCodeResponse(installResultCollection);

    if (installResults.succeeded) {
        installResults.mainMessage = `Azure Service Operator Successfully installed on ${clustername}. Please see the console output below for more details.`;
    } else {
        installResults.mainMessage = `Azure Service Operator Failed to install on ${clustername}. Please see the console output below for more details.`;
    }

    const logs = [];

    if (certManagerResult) {
        logs.push(getHtmlLogSectionFromResponse("Cert Manager Output", certManagerResult));
    }

    if (certManagerSatatusResult) {
        logs.push(getHtmlLogSectionFromResponse("Issuer Cert RollOut Status", certManagerSatatusResult));
    }

    if (issuerCertResult) {
        logs.push(getHtmlLogSectionFromResponse("Issuer Cert Output", issuerCertResult));
    }

    if (olmCrdResult) {
        logs.push(getHtmlLogSectionFromResponse("Install Operator Lifecycle CRD Output", olmCrdResult));
    }

    if (olmResult) {
        logs.push(getHtmlLogSectionFromResponse("Install Operator Lifecycle Output", olmResult));
    }

    if (operatorResult) {
        logs.push(getHtmlLogSectionFromResponse("Install Operator Output", operatorResult));
    }

    if (operatorSettingsResult) {
        logs.push(getHtmlLogSectionFromResponse("ASO Setting Apply Output", operatorSettingsResult));
    }

    if (getOperatorsPodResult) {
        logs.push(getHtmlLogSectionFromResponse("Operator pod output", getOperatorsPodResult));
    }

    installResults.logs = logs;

    return installResults;
}

function getHtmlLogSectionFromResponse(
    title: string,
    shellResult: k8s.KubectlV1.ShellResult
): LogSection {
    const logSection: LogSection = {};

    if (shellResult) {
        logSection.title = title;
        logSection.messages = installationStdResponse(shellResult);
    }

    return logSection;
}

function installationStdResponse(
    installShellResult: k8s.KubectlV1.ShellResult | undefined
): string | undefined {
    // Standard output code of all the installation response.
    return installShellResult ? installShellResult.stderr + installShellResult.stdout : undefined;
}

function installationExitCodeResponse(
    installShellResult: (k8s.KubectlV1.ShellResult | undefined)[],
): boolean {
    const isSuccess = installShellResult.filter(Boolean).every((sr) => !!sr && sr.code === 0);

    return isSuccess;
}

export function htmlHandlerRegisterHelper() {
    htmlhandlers.registerHelper("breaklines", breaklines);
}

function breaklines(text: any): any {
    if (text) {
        text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    }
    return text;
}