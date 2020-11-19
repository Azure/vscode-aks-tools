import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';
import { getExtensionPath } from '../../utils/host';
import { OperatorSettings } from '../models/operatorSettings';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';

export async function getKubectlGetOperatorsPod(): Promise<k8s.KubectlV1.ShellResult | undefined> {
    // kubectl get pods -n operators
    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) return undefined;

    const finalOutPut = await kubectl.api.invokeCommand("get pods -n operators");
    return finalOutPut;
}

export async function applyCertManager(): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const kubectl = await k8s.extension.kubectl.v1;
        let runResult;
        if (kubectl.available) {
            runResult = await kubectl.api.invokeCommand(`apply -f https://github.com/jetstack/cert-manager/releases/download/v0.12.0/cert-manager.yaml`);
        }

        return runResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Cert Manager Deployment file had following error: ${e}`);
        return undefined;
    }
}

export async function runASOIssuerCertYAML(): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'Issuerandcertmanager.yaml'));

        const fileContents = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');

        const kubectl = await k8s.extension.kubectl.v1;
        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                fileContents, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${f}`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`ASO Issuer and Cert Deployment file had following error: ${e}`);
        return undefined;
    }
}

export async function getAzureServicePrincipal(
    target: AksClusterTreeItem
): Promise<OperatorSettings | undefined> {
    // Note: Will be removed
    // So what is happenign here?
    // There is no way I could see we can generate ServicePricipal credential for the user.
    // Refer this page: https://operatorhub.io/operator/azure-service-operator : essentially this page gives reference to how user can generate one.
    // hence we need AppId and ClientSecret for ServicePrincipal from the user.
    // I have had a look in here:
    // ==> https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli#password-based-authentication 
    // ==> https://docs.microsoft.com/en-us/javascript/api/overview/azure/keyvault-secrets-readme?view=azure-node-latest

    const optionsAppId: vscode.InputBoxOptions = {
        prompt: "AppID of Service Principal: \n (Please refer to this page for (click here)[https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli#password-based-authentication]) ",
        placeHolder: "AppId of Service Principal",
        ignoreFocusOut: true
    };
    const optionsPassword: vscode.InputBoxOptions = {
        prompt: "Password of Service Principal: (Please refer to this page for (click here)[https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli#password-based-authentication])",
        placeHolder: "Password for the Service Principal.",
        ignoreFocusOut: true
    };

    const spquickinputAppIdBox = await vscode.window.showInputBox(optionsAppId);
    const spquickinputPasswordBox = await vscode.window.showInputBox(optionsPassword);

    return <OperatorSettings><unknown>{
        tenantId: target.root.tenantId,
        subId: target.subscription.subscriptionId,
        appId: spquickinputAppIdBox,
        clientSecret: spquickinputPasswordBox,
        cloudEnv: convertAzureCloudEnv(target.root.environment.name)
    };
}

export async function applyAzureOperatorSettingsYAML(
    operatorSettingInfo: OperatorSettings
): Promise<k8s.KubectlV1.ShellResult | undefined> {
    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

        const fileContents = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8');
        fileContents.replace("<TENANT_ID>", operatorSettingInfo.tenantId);
        fileContents.replace("<SUB_ID>", operatorSettingInfo.subId);
        fileContents.replace("<APP_ID>", operatorSettingInfo.appId);
        fileContents.replace("<CLIENT_SECRET>", operatorSettingInfo.clientSecret);
        fileContents.replace("<ENV_CLOUD>", operatorSettingInfo.cloudEnv);

        const kubectl = await k8s.extension.kubectl.v1;
        let runCommandResult;
        if (kubectl.available) {
            runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
                fileContents, "YAML",
                (f) => kubectl.api.invokeCommand(`apply -f ${f}`));
        }

        return runCommandResult;
    } catch (e) {
        vscode.window.showErrorMessage(`Apply ASO Settings had following error: ${e}`);
        return undefined;
    }
}

function convertAzureCloudEnv(cloudName: string): string {
    if (cloudName === "AzureUSGovernmentCloud") {
        return "AzureUSGovernmentCloud";

    }
    if (cloudName === "AzureChinaCloud") {
        return "AzureChinaCloud";

    }
    if (cloudName === "AzureGermanCloud") {
        return "AzureGermanCloud";
    }

    return "AzurePublicCloud";
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
    // text = Handlebars.Utils.escapeExpression(text);
    text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    return text;
}