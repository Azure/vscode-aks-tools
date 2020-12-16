import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';
import { InstallationResponse } from '../models/installationResponse';

interface InstallResult {
    succeeded?: boolean;
    mainMessage?: string;
    logs?: LogSection[];
}

interface LogSection {
    title?: string;
    messages?: string;
}

export function createASOWebViewPanel(
    installationResponse: InstallationResponse
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        `Azure Service Operator`,
        `Azure service Operator: ${installationResponse.clusterName}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    return panel;
}

export function createASOWebView(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    installationResponse: InstallationResponse,
    getUserInput = false
) {
    // For the case of successful run of the tool we render webview with the output information.
    panel.webview.html = getWebviewContent(
        installationResponse.clusterName,
        extensionPath,
        installationResponse,
        getUserInput);
}

function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    installationResponse: InstallationResponse,
    getUserInput: boolean
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
        isSuccess: installHtmlResult.succeeded,
        getUserInput: getUserInput
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

export function convertAzureCloudEnv(cloudName: string): string | undefined {
    // Cloud env map: https://docs.microsoft.com/en-us/azure/storage/common/storage-powershell-independent-clouds#get-endpoint-using-get-azenvironment
    if (cloudName === "AzureCloud") {
        return "AzurePublicCloud";
    }
    if (cloudName === "AzureUSGovernment") {
        return "AzureUSGovernmentCloud";
    }
    if (cloudName === "AzureChinaCloud" || cloudName === "AzureGermanCloud") {
        return cloudName;
    }

    return undefined;
}