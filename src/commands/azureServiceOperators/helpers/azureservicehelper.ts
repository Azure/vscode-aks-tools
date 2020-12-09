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
        prompt: "AppID of Service Principal: ",
        placeHolder: "Enter AppId of Service Principal",
        ignoreFocusOut: true
    };
    const optionsPassword: vscode.InputBoxOptions = {
        prompt: "Password of Service Principal",
        placeHolder: "Enter Password for the Service Principal.",
        ignoreFocusOut: true
    };

    const inputAppIdBox = await vscode.window.showInputBox(optionsAppId);
    const inputPasswordBox = await vscode.window.showInputBox(optionsPassword);

    return <OperatorSettings>{
        tenantId: aksCluster.root.tenantId,
        subId: aksCluster.subscription.subscriptionId,
        appId: inputAppIdBox,
        clientSecret: inputPasswordBox,
        cloudEnv: aksCluster.root.environment.name
    };
}

export async function getOperatorsPod(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    try {
        const finalOutPut = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`get pods -n operators --kubeconfig="${f}"`));
        return finalOutPut;
    } catch (e) {
        vscode.window.showErrorMessage(`Get operator pod had following error: ${e}`);
        return undefined;
    }
}

export async function installCertManager(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const cerManagerFile = "https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`apply -f ${cerManagerFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Cert Manager install had following error: ${e}`);
        return undefined;
    }
}

export async function checkCertManagerRolloutStatus(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`rollout status -n cert-manager deploy/cert-manager-webhook --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Cert Manager Rollout had following error: ${e}`);
        return undefined;
    }
}

export async function installOlmCrd(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const asoCrdYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/crds.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`create -f ${asoCrdYamlFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager CRD resource had following error: ${e}`);
        return undefined;
    }
}

export async function installOlm(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const asoOlmYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/olm.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`create -f ${asoOlmYamlFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager resource had following error: ${e}`);
        return undefined;
    }
}

export async function installOperator(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const asoYamlFile = "https://operatorhub.io/install/azure-service-operator.yaml";
        const runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`create -f ${asoYamlFile} --kubeconfig="${f}"`));

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator resoruce had following error: ${e}`);
        return undefined;
    }
}

export async function installIssuerCert(
    kubectl: k8s.APIAvailable<any>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const templateYAML = tmp.fileSync({ prefix: "aso-issuer", postfix: `.yaml` });
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'issuerandcertmanager.yaml'));
        const issuerandcertmanager = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
        fs.writeFileSync(templateYAML.name, issuerandcertmanager);

        const runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`apply -f ${templateYAML.name} --kubeconfig="${f}"`));

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Issuer and Cert Deployment file had following error: ${e}`);
        return undefined;
    }
}

export async function installOperatorSettings(
    kubectl: k8s.APIAvailable<any>,
    operatorSettingInfo: OperatorSettings,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

        const azureoperatorsettings = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
        azureoperatorsettings
            .replace("<TENANT_ID>", operatorSettingInfo.tenantId)
            .replace("<SUB_ID>", operatorSettingInfo.subId)
            .replace("<APP_ID>", operatorSettingInfo.appId)
            .replace("<CLIENT_SECRET>", operatorSettingInfo.clientSecret)
            .replace("<ENV_CLOUD>", operatorSettingInfo.cloudEnv);

        const templateYaml = tmp.fileSync({ prefix: "aso-operatorsettings", postfix: `.yaml` });
        fs.writeFileSync(templateYaml.name, azureoperatorsettings);

        const runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
            clusterKubeConfig, "YAML",
            (f) => kubectl.api.invokeCommand(`apply -f ${templateYaml.name} --kubeconfig="${f}"`));

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Install operator settings had following error: ${e}`);
        return undefined;
    }
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
    const certManagerResult = installationResponse.installCertManagerResult;
    const certManagerSatatusResult = installationResponse.checkCertManagerRolloutStatusResult;
    const issuerCertResult = installationResponse.installIssuerCertResult;
    const olmCrdResult = installationResponse.installOlmCrdResult;
    const olmResult = installationResponse.installOlmResult;
    const operatorResult = installationResponse.installOperatorSettingsResult;
    const operatorSettingsResult = installationResponse.installOperatorResult;
    const getOperatorsPodResult = installationResponse.getOperatorsPodResult;

    let exitCode = 0;

    // If total of outputCode is more than 0 then obviously something failed and display the html error, with std ouput.
    exitCode = installationExitCodeResponse(exitCode, certManagerResult);
    exitCode = installationExitCodeResponse(exitCode, certManagerSatatusResult);
    exitCode = installationExitCodeResponse(exitCode, issuerCertResult);
    exitCode = installationExitCodeResponse(exitCode, olmCrdResult);
    exitCode = installationExitCodeResponse(exitCode, olmResult);
    exitCode = installationExitCodeResponse(exitCode, operatorResult);
    exitCode = installationExitCodeResponse(exitCode, operatorSettingsResult);
    exitCode = installationExitCodeResponse(exitCode, getOperatorsPodResult);

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        name: clustername,
        certManagerOutput: installationStdResponse(certManagerResult),
        certManagerRolloutStatus: installationStdResponse(certManagerSatatusResult),
        issuerOutput: installationStdResponse(issuerCertResult),
        installOlmCrdOutput: installationStdResponse(olmCrdResult),
        installOlmOutput: installationStdResponse(olmResult),
        installOperatorOutput: installationStdResponse(operatorResult),
        asoSettingsOutput: installationStdResponse(operatorSettingsResult),
        getOperatorsPodOutput: installationStdResponse(getOperatorsPodResult),
        outputCode: exitCode
    };
    const webviewcontent = template(data);

    return webviewcontent;
}

function installationStdResponse(
    installShellResult: k8s.KubectlV1.ShellResult | undefined
): string | undefined {
    // Standard output code of all the installation response.
    return installShellResult ? installShellResult.stderr + installShellResult.stdout : undefined
}

function installationExitCodeResponse(
    exitCode: number,
    installShellResult: k8s.KubectlV1.ShellResult | undefined
): number {

    if (exitCode === 0 && installShellResult) {
        exitCode += installShellResult.code;
        return exitCode;
    }

    return exitCode;
}

export function htmlHandlerRegisterHelper() {
    htmlhandlers.registerHelper("equalsZero", equalsZero);
    htmlhandlers.registerHelper("isNonZeroNumber", isNonZeroNumber);
    htmlhandlers.registerHelper("breaklines", breaklines);
}

function equalsZero(value: number): boolean {
    return value === 0;
}

function isNonZeroNumber(value: any): boolean {
    if (isNaN(Number(value))) {
        return false;
    }
    return value !== 0;
}

function breaklines(text: any): any {
    if (text) {
        text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    }
    return text;
}