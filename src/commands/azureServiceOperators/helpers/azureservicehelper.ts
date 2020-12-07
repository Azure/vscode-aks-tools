import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionPath } from '../../utils/host';
import { OperatorSettings } from '../models/operatorSettings';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';
const tmp = require('tmp');

export async function getAzureServicePrincipal(
    aksCluster: AksClusterTreeItem
): Promise<OperatorSettings | undefined> {

    const optionsAppId: vscode.InputBoxOptions = {
        prompt: "AppID of Service Principal: ",
        placeHolder: "AppId of Service Principal",
        ignoreFocusOut: true
    };
    const optionsPassword: vscode.InputBoxOptions = {
        prompt: "Password of Service Principal",
        placeHolder: "Password for the Service Principal.",
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

export async function getKubectlGetOperatorsPod(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    if (!kubectl.available) return undefined;

    const finalOutPut = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
        clusterKubeConfig, "YAML",
        (f) => kubectl.api.invokeCommand(`get pods -n operators --kubeconfig="${f}"`));
    return finalOutPut;
}

export async function installCertManager(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        let runResult;
        if (kubectl.available) {
            const cerManagerFile = "https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml";
            runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${cerManagerFile} --kubeconfig="${f}"`));
        }

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Cert Manager install had following error: ${e}`);
        return undefined;
    }
}

export async function checkCertManagerRolloutStatus(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        let runResult;
        if (kubectl.available) {
            runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`rollout status -n cert-manager deploy/cert-manager-webhook --kubeconfig="${f}"`));
        }

        if (runResult?.code !== 0) {
            vscode.window.showErrorMessage(`Cert Manager Rollout had following error: ${runResult?.stderr}`);
            return undefined;
        }

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Cert Manager Rollout had following error: ${e}`);
        return undefined;
    }
}

export async function installOlmCrd(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        let runResult;
        if (kubectl.available) {
            const asoCrdYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/crds.yaml";

            runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`create -f ${asoCrdYamlFile} --kubeconfig="${f}"`));
        }
        return runResult;

    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager CRD resource had following error: ${e}`);
        return undefined;
    }
}

export async function installOlm(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        let runResult;
        if (kubectl.available) {
            const asoOlmYamlFile = "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/v0.17.0/olm.yaml";

            runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`create -f ${asoOlmYamlFile} --kubeconfig="${f}"`));
        }
        return runResult;

    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator lifecycle manager resource had following error: ${e}`);
        return undefined;
    }
}

export async function installOperator(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        let runResult;
        if (kubectl.available) {
            const asoYamlFile = "https://operatorhub.io/install/azure-service-operator.yaml";

            runResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`create -f ${asoYamlFile} --kubeconfig="${f}"`));
        }
        return runResult;

    } catch (e) {
        vscode.window.showErrorMessage(`Installing operator resoruce had following error: ${e}`);
        return undefined;
    }
}

export async function installIssuerCert(
    kubectl: k8s.API<k8s.KubectlV1>,
    clusterKubeConfig: string
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const templateYAML = tmp.fileSync({ prefix: "aso-issuer", postfix: `.yaml` });

        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'issuerandcertmanager.yaml'));

        const issuerandcertmanager = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
        fs.writeFileSync(templateYAML.name, issuerandcertmanager);

        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${templateYAML.name} --kubeconfig="${f}"`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Issuer and Cert Deployment file had following error: ${e}`);
        return undefined;
    }
}

export async function installOperatorSettings(
    kubectl: k8s.API<k8s.KubectlV1>,
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

        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                clusterKubeConfig, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${templateYaml.name} --kubeconfig="${f}"`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Install operator settings had following error: ${e}`);
        return undefined;
    }
}

export function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    outputCertManagerResult: k8s.KubectlV1.ShellResult | undefined,
    outputIssuerCertResult: k8s.KubectlV1.ShellResult | undefined,
    outputASOSettingResult: k8s.KubectlV1.ShellResult | undefined,
    output: k8s.KubectlV1.ShellResult | undefined
): string {
    const stylePathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const commandCertManagerOutput = outputCertManagerResult ? outputCertManagerResult.stderr + outputCertManagerResult.stdout : undefined;
    const commandIssuerOutput = outputIssuerCertResult ? outputIssuerCertResult.stderr + outputIssuerCertResult.stdout : undefined;
    const commandASOSettingsOutput = outputASOSettingResult ? outputASOSettingResult.stderr + outputASOSettingResult.stdout : undefined;
    const commandOutput = output ? output.stderr + output.stdout : undefined;

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        storageAccName: "test",
        name: clustername,
        certManagerOutput: commandCertManagerOutput,
        issuerOutput: commandIssuerOutput,
        asoSettingsOutput: commandASOSettingsOutput,
        output: commandOutput,
        outputCode: output?.code
    };
    const webviewcontent = template(data);

    return webviewcontent;
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
    text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    return text;
}