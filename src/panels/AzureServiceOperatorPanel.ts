import * as vscode from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { failed, getErrorMessage, map as errmap, combine } from '../commands/utils/errorable';
import { ASOCloudName, AzureCloudName, CommandResult, InitialState, ToVsCodeMsgDef, ToWebViewMsgDef, azureToASOCloudMap } from "../webview-contract/webviewDefinitions/azureServiceOperator";
import { AzureAccountExtensionApi, getServicePrincipalAccess } from "../commands/utils/azureAccount";
import { NonZeroExitCodeBehaviour, invokeKubectlCommand } from "../commands/utils/kubectl";
import path = require("path");
import { fs } from "../commands/utils/fs";
import { createTempFile } from "../commands/utils/tempfile";

export class AzureServiceOperatorPanel extends BasePanel<"aso"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "aso", {
            checkSPResponse: null,
            installCertManagerResponse: null,
            installOperatorResponse: null,
            installOperatorSettingsResponse: null,
            waitForCertManagerResponse: null,
            waitForControllerManagerResponse: null
        });
    }
}

export class AzureServiceOperatorDataProvider implements PanelDataProvider<"aso"> {
    constructor(
        readonly extension: vscode.Extension<vscode.ExtensionContext>,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly azAccount: AzureAccountExtensionApi,
        readonly clusterName: string
    ) { }

    getTitle(): string {
        return `ASO on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            checkSPRequest: args => this._handleCheckSPRequest(args.appId, args.appSecret, webview),
            installCertManagerRequest: _ => this._handleInstallCertManagerRequest(webview),
            waitForCertManagerRequest: _ => this._handleWaitForCertManagerRequest(webview),
            installOperatorRequest: _ => this._handleInstallOperatorRequest(webview),
            installOperatorSettingsRequest: args => this._handleInstallOperatorSettingsRequest(args.appId, args.appSecret, args.cloudName, args.subscriptionId, args.tenantId, webview),
            waitForControllerManagerRequest: _ => this._handleWaitForControllerManagerRequest(webview)
        };
    }

    private async _handleCheckSPRequest(appId: string, appSecret: string, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const servicePrincipalAccess = await getServicePrincipalAccess(this.azAccount, appId, appSecret);
        if (failed(servicePrincipalAccess)) {
            webview.postCheckSPResponse({
                succeeded: false,
                errorMessage: servicePrincipalAccess.error,
                commandResults: [],
                cloudName: null,
                subscriptions: [],
                tenantId: null
            });
            return;
        }

        webview.postCheckSPResponse({
            succeeded: true,
            errorMessage: null,
            commandResults: [],
            cloudName: servicePrincipalAccess.result.cloudName as AzureCloudName,
            subscriptions: servicePrincipalAccess.result.subscriptions,
            tenantId: servicePrincipalAccess.result.tenantId
        });
    }

    private async _handleInstallCertManagerRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        // From installation instructions:
        // https://azure.github.io/azure-service-operator/#installation
        const asoCrdYamlFile = "https://github.com/jetstack/cert-manager/releases/download/v1.12.1/cert-manager.yaml";
        const kubectlArgs = `create -f ${asoCrdYamlFile}`;
        const shellOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, kubectlArgs, NonZeroExitCodeBehaviour.Succeed);
        if (failed(shellOutput)) {
            webview.postInstallCertManagerResponse({
                succeeded: false,
                errorMessage: shellOutput.error,
                commandResults: []
            });
            return;
        }

        const succeeded = shellOutput.result.code === 0;
        const errorMessage = succeeded ? null : "Installing cert-manager failed, see error output.";
        const { stdout, stderr } = shellOutput.result;
        const command = `kubectl ${kubectlArgs}`;
        webview.postInstallCertManagerResponse({
            succeeded,
            errorMessage,
            commandResults: [{ command, stdout, stderr }]
        });
    }

    private async _handleWaitForCertManagerRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const deployments = ['cert-manager', 'cert-manager-cainjector', 'cert-manager-webhook'];
        const promiseResults = await Promise.all(deployments.map(async d => {
            const kubectlArgs =  `rollout status -n cert-manager deploy/${d} --timeout=240s`;
            const shellOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, kubectlArgs, NonZeroExitCodeBehaviour.Succeed);
            return errmap<k8s.KubectlV1.ShellResult, k8s.KubectlV1.ShellResult & CommandResult>(shellOutput, sr => ({...sr, command: `kubectl ${kubectlArgs}`}));
        }));
        const shellResults = combine(promiseResults);
        if (failed(shellResults)) {
            webview.postWaitForCertManagerResponse({
                succeeded: false,
                errorMessage: shellResults.error,
                commandResults: []
            });
            return;
        }

        // There was no error running the commands, but there may have been a non-zero exit code.
        const succeeded = !shellResults.result.some(r => r.code !== 0);
        const errorMessage = succeeded ? null : "Waiting for cert-manager failed, see error output.";
        webview.postWaitForCertManagerResponse({
            succeeded,
            errorMessage,
            commandResults: shellResults.result.map(r => ({command: r.command, stdout: r.stdout, stderr: r.stderr}))
        });
    }

    private async _handleInstallOperatorRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const asoYamlFile = "https://github.com/Azure/azure-service-operator/releases/download/v2.0.0/azureserviceoperator_v2.0.0.yaml";

        // Use a larger-than-default request timeout here, because cert-manager sometimes does some certificate re-issuing
        // when ASO resources are created, and it takes time for the inject reconciler (cert-manager-cainjector) to update the resources.
        // NOTE: We use 'create' here, and not 'apply' as suggested in the documentation, because we want to be cautious and avoid
        // updating an existing installation. Instead we will use create to fail if it is already installed.
        // This also means we don't need the '--server-side=true' argument, which affects change tracking (there will be no changes if
        // the operator does not exist).
        const kubectlArgs = `create -f ${asoYamlFile} --request-timeout 120s`;
        const shellOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, kubectlArgs, NonZeroExitCodeBehaviour.Succeed);
        if (failed(shellOutput)) {
            webview.postInstallOperatorResponse({
                succeeded: false,
                errorMessage: shellOutput.error,
                commandResults: []
            });
            return;
        }

        const succeeded = shellOutput.result.code === 0;
        const errorMessage = succeeded ? null : "Installing operator resource failed, see error output.";
        const { stdout, stderr } = shellOutput.result;
        const command = `kubectl ${kubectlArgs}`;
        webview.postInstallOperatorResponse({
            succeeded,
            errorMessage,
            commandResults: [{ command, stdout, stderr }]
        });
    }

    private async _handleInstallOperatorSettingsRequest(appId: string, appSecret: string, cloudName: AzureCloudName, subscriptionId: string, tenantId: string, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const cloudEnv: ASOCloudName = azureToASOCloudMap[cloudName];
        const yamlPathOnDisk = vscode.Uri.file(path.join(this.extension.extensionPath, 'resources', 'yaml', 'azureoperatorsettings.yaml'));

        let settingsTemplate: string;
        try {
            settingsTemplate = await fs.readFile(yamlPathOnDisk.fsPath, 'utf8');
        } catch (e) {
            webview.postInstallOperatorSettingsResponse({
                succeeded: false,
                errorMessage: `Failed to read settings template from ${yamlPathOnDisk.fsPath}: ${getErrorMessage(e)}`,
                commandResults: []
            });
            return;
        }

        const settings = settingsTemplate
            .replace("<TENANT_ID>", tenantId)
            .replace("<SUB_ID>", subscriptionId)
            .replace("<APP_ID>", appId)
            .replace("<CLIENT_SECRET>", appSecret)
            .replace("<ENV_CLOUD>", cloudEnv);

        const templateYamlFile = await createTempFile(settings, "yaml");
    
        // Use a larger-than-default request timeout here, because cert-manager-cainjector is still busy updating resources, increasing response times.
        const kubectlArgs = `apply -f ${templateYamlFile.filePath} --request-timeout 120s`;
        const shellOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, kubectlArgs, NonZeroExitCodeBehaviour.Succeed);
        if (failed(shellOutput)) {
            webview.postInstallOperatorSettingsResponse({
                succeeded: false,
                errorMessage: shellOutput.error,
                commandResults: []
            });
            return;
        }

        const succeeded = shellOutput.result.code === 0;
        const errorMessage = succeeded ? null : "Installing operator settings failed, see error output.";
        const { stdout, stderr } = shellOutput.result;
        const command = `kubectl ${kubectlArgs}`;
        webview.postInstallOperatorSettingsResponse({
            succeeded,
            errorMessage,
            commandResults: [{ command, stdout, stderr }]
        });
    }

    private async _handleWaitForControllerManagerRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const kubectlArgs = "rollout status -n azureserviceoperator-system deploy/azureserviceoperator-controller-manager --timeout=240s";
        const shellOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, kubectlArgs, NonZeroExitCodeBehaviour.Succeed);
        if (failed(shellOutput)) {
            webview.postWaitForControllerManagerResponse({
                succeeded: false,
                errorMessage: shellOutput.error,
                commandResults: []
            });
            return;
        }

        const succeeded = shellOutput.result.code === 0;
        const errorMessage = succeeded ? null : "Waiting for ASO Controller Manager failed, see error output.";
        const { stdout, stderr } = shellOutput.result;
        const command = `kubectl ${kubectlArgs}`;
        webview.postWaitForControllerManagerResponse({
            succeeded,
            errorMessage,
            commandResults: [{ command, stdout, stderr }]
        });
    }
}
