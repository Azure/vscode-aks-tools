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
    const olmCrdResult = installationResponse.installOlmCrdResult;
    const olmResult = installationResponse.installOlmResult;
    const operatorResult = installationResponse.installOperatorSettingsResult;
    const operatorSettingsResult = installationResponse.installOperatorResult;
    const getOperatorsPodResult = installationResponse.getOperatorsPodResult;

    const installResultCollection = [olmCrdResult, olmResult, operatorResult, operatorSettingsResult, getOperatorsPodResult];
    installResults.succeeded = installationExitCodeResponse(installResultCollection);

    if (installResults.succeeded) {
        installResults.mainMessage = `Azure Service Operator Successfully installed on ${clustername}. Please see the console output below for more details.`;
    } else {
        installResults.mainMessage = `Azure Service Operator Failed to install on ${clustername}. Please see the console output below for more details. <a href="https://aka.ms/aks/aso-debug">Learn more about common issues.</a>`;
    }

    installResults.logs = installationLogsResponse(installResultCollection);

    return installResults;
}

function installationLogsResponse(
    installShellResult: (k8s.KubectlV1.ShellResult | undefined)[],
): LogSection[] {
    const logs: LogSection[] = [];

    const logsTitle: { [order: number]: string } = {
        0: "Install Operator Lifecycle CRD Output",
        1: "Install Operator Lifecycle Output",
        2: "Install Operator Output",
        3: "Setting Apply Operator Output",
        4: "Operator pod output",
    };

    installShellResult.filter(Boolean).forEach((sr, index) => {
        if (sr) {
            logs.push(getHtmlLogSectionFromResponse(logsTitle[index], sr));
        }
    });

    return logs;
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
    const cloudEnvironment: { [cloudType: string]: string } = {
        AzureChinaCloud: "AzureChinaCloud",
        AzureCloud: "AzurePublicCloud",
        AzureGermanCloud: "AzureGermanCloud",
        AzureUSGovernment: "AzureUSGovernmentCloud",
      };

    return cloudEnvironment[cloudName];
}