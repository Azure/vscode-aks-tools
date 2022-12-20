import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { install } from './helpers/azureservicehelper';
import { getKubernetesClusterInfo, KubernetesClusterInfo } from '../utils/clusters';
import { getExtensionPath } from '../utils/host';
import { createWebView, getRenderedContent, getResourceUri } from '../utils/webviews';
import { failed, succeeded } from '../utils/errorable';
import { AzureAccountExtensionApi, getAzureAccountExtensionApi } from '../utils/azureAccount';
import { getServicePrincipalAccess } from './helpers/servicePrincipalHelper';

export default async function installAzureServiceOperator(
    _context: IActionContext,
    target: any
): Promise<void> {
    const kubectl = await k8s.extension.kubectl.v1;
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const clusterExplorer = await k8s.extension.clusterExplorer.v1;

    if (!kubectl.available) {
        vscode.window.showWarningMessage(`Kubectl is unavailable.`);
        return undefined;
    }

    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage(`Cloud explorer is unavailable.`);
        return undefined;
    }

    if (!clusterExplorer.available) {
        vscode.window.showWarningMessage(`Cluster explorer is unavailable.`);
        return undefined;
    }

    const azureAccountApi = getAzureAccountExtensionApi();
    if (failed(azureAccountApi)) {
        vscode.window.showErrorMessage(azureAccountApi.error);
        return undefined;
    }

    const clusterInfo = await getKubernetesClusterInfo(target, cloudExplorer, clusterExplorer);
    if (failed(clusterInfo)) {
        vscode.window.showErrorMessage(clusterInfo.error);
        return undefined;
    }

    await displayInstallWebview(kubectl, clusterInfo.result, azureAccountApi.result);
    clusterExplorer.api.refresh();
}

export async function displayInstallWebview(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterInfo: KubernetesClusterInfo,
    azureAccountApi: AzureAccountExtensionApi
): Promise<void> {
    // Get user input upfront.
    // Get Service Principal AppId and Password from user.
    // Then start the installation process.
    const webview = createWebView('Azure Service Operator', `Azure service Operator: ${clusterInfo.name}`).webview;

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return undefined;
    }

    // Create webview with user input required.
    webview.html = getWebviewContent(webview, extensionPath.result, clusterInfo.name);

    // Once the submit for them webview is successfull we handle rest of the installation process for Azure Service Operator.
    webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case "get_subscriptions_request":
                {
                    const servicePrincipalAccess = await getServicePrincipalAccess(azureAccountApi, message.appId, message.appSecret);
                    const resultSection: ResultSection = {
                        succeeded: succeeded(servicePrincipalAccess),
                        message: succeeded(servicePrincipalAccess) ? "Service Principal validated successfully": servicePrincipalAccess.error,
                        resultLogs: []
                    };
                    const responseMessage = {
                        command: 'get_subscriptions_response',
                        succeeded: succeeded(servicePrincipalAccess),
                        resultHtml: getResultSectionHtml(webview, extensionPath.result, resultSection),
                        cloudName: succeeded(servicePrincipalAccess) ? servicePrincipalAccess.result.cloudName : "",
                        tenantId: succeeded(servicePrincipalAccess) ? servicePrincipalAccess.result.tenantId : "",
                        subscriptions: succeeded(servicePrincipalAccess) ? servicePrincipalAccess.result.subscriptions : []
                    };
                    webview.postMessage(responseMessage);
                    return;
                }
                case "install_request":
                {
                    const operatorSettingsInfo = {
                        tenantId: message.tenantId,
                        subId: message.subscriptionId,
                        appId: message.appId,
                        clientSecret: message.appSecret,
                        cloudEnv: message.cloudName
                    };

                    const installOutput = await install(kubectl, extensionPath.result, clusterInfo.kubeconfigYaml, operatorSettingsInfo);
                    const resultSection: ResultSection = {
                        succeeded: succeeded(installOutput) && installOutput.result.ranWithoutError,
                        message:
                            failed(installOutput) ? installOutput.error
                            : installOutput.result.ranWithoutError ? `Azure Service Operator Successfully installed on ${clusterInfo.name}. Please see the console output below for more details.`
                            : `Azure Service Operator Failed to install on ${clusterInfo.name}. Please see the console output below for more details. <a href="https://aka.ms/aks/aso-debug">Learn more about common issues.</a>`,
                        resultLogs: succeeded(installOutput) ? installOutput.result.steps.map(s => ({title: s.title, output: `${s.result.stderr}\n${s.result.stdout}`})) : []
                    };
                    const responseMessage = {
                        command: 'install_response',
                        succeeded: resultSection.succeeded,
                        resultHtml: getResultSectionHtml(webview, extensionPath.result, resultSection)
                    };
                    webview.postMessage(responseMessage);
                    return;
                }
                default:
                    vscode.window.showErrorMessage(`Unexpected command from webview: ${message.command}`);
            }
        },
        undefined
    );
}

function getWebviewContent(
    webview: vscode.Webview,
    aksExtensionPath: string,
    clustername: string
): string {
    const styleUri = getResourceUri(webview, aksExtensionPath, 'azureserviceoperator', 'azureserviceoperator.css');
    const templateUri = getResourceUri(webview, aksExtensionPath, 'azureserviceoperator', 'azureserviceoperator.html');

    const data = {
        cssuri: styleUri,
        name: clustername
    };

    return getRenderedContent(templateUri, data);
}

function getResultSectionHtml(webview: vscode.Webview, aksExtensionPath: string, resultSection: ResultSection): string {
    const templateUri = getResourceUri(webview, aksExtensionPath, 'azureserviceoperator', 'result-section.html');
    return getRenderedContent(templateUri, resultSection);
}

interface ResultSection {
    readonly succeeded: boolean;
    readonly message: string;
    readonly resultLogs: {
        readonly title: string;
        readonly output: string;
    }[];
}