import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { InstallationResponse } from '../models/installationResponse';
import { getRenderedContent, getResourceUri } from '../../utils/webviews';

interface InstallResult {
    succeeded?: boolean;
    mainMessage?: string;
    logs?: LogSection[];
}

interface LogSection {
    title?: string;
    messages?: string;
}

export function createASOWebView(
    webview: vscode.Webview,
    extensionPath: string,
    installationResponse: InstallationResponse,
    getUserInput = false
) {
    // For the case of successful run of the tool we render webview with the output information.
    webview.html = getWebviewContent(
        installationResponse.clusterName,
        extensionPath,
        installationResponse,
        getUserInput,
        webview);
}

function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    installationResponse: InstallationResponse,
    getUserInput: boolean,
    webview: vscode.Webview
): string {
    const styleUri = getResourceUri(webview, aksExtensionPath, 'azureserviceoperator', 'azureserviceoperator.css');
    const templateUri = getResourceUri(webview, aksExtensionPath, 'azureserviceoperator', 'azureserviceoperator.html');

    const installHtmlResult = getOrganisedInstallResult(clustername, installationResponse);
    const data = {
        cssuri: styleUri,
        name: clustername,
        mainMessage: installHtmlResult.mainMessage,
        resultLogs: installHtmlResult.logs,
        isSuccess: installHtmlResult.succeeded,
        getUserInput: getUserInput
    };

    return getRenderedContent(templateUri, data);
}

function getOrganisedInstallResult(
    clustername: string,
    installationResponse: InstallationResponse
) {
    const installResults: InstallResult = {};
    const certManagerResult = installationResponse.installCertManagerResult;
    const operatorResult = installationResponse.installOperatorSettingsResult;
    const operatorSettingsResult = installationResponse.installOperatorResult;
    const getOperatorsPodResult = installationResponse.getOperatorsPodResult;

    const installResultCollection = [certManagerResult, operatorResult, operatorSettingsResult, getOperatorsPodResult];
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
        0: "Install Cert Manager Output",
        1: "Install Operator Output",
        2: "Setting Apply Operator Output",
        3: "Operator pod output",
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