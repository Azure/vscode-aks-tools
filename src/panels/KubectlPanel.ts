import { Uri } from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { Errorable, failed, getErrorMessage, succeeded } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { AIKeyStatus, InitialState, PresetCommand, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kubectl";
import { addKubectlCustomCommand, deleteKubectlCustomCommand, getOpenAIConfig, setOpenAIConfigApiKey } from "../commands/utils/config";
import { getOpenAIResult } from "../commands/utils/helper/openaiHelper";
import { OpenAIConfig } from "../commands/utils/helper/openaiConfig";
import { Observable } from "rxjs";

export class KubectlPanel extends BasePanel<"kubectl"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kubectl");
    }
}

export class KubectlDataProvider implements PanelDataProvider<"kubectl"> {
    openAIConfig = getOpenAIConfig();
    openAIKeyStatus = failed(this.openAIConfig) ? AIKeyStatus.Missing : AIKeyStatus.Unverified;

    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly clusterName: string,
        readonly customCommands: PresetCommand[]
    ) { }

    getTitle(): string {
        return `Run Kubectl on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            customCommands: this.customCommands
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            runCommandRequest: args => this._handleRunCommandRequest(args.command, webview),
            addCustomCommandRequest: args => this._handleAddCustomCommandRequest(args.name, args.command),
            deleteCustomCommandRequest: args => this._handleDeleteCustomCommandRequest(args.name),
            getAIKeyStatus: _args => this._handleGetAIKeyStatus(webview),
            updateAIKeyRequest: args => this._handleUpdateAIKeyRequest(args.apiKey, webview)
        };
    }

    private async _handleRunCommandRequest(command: string, webview: MessageSink<ToWebViewMsgDef>) {
        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);

        if (failed(kubectlresult)) {
            await this._sendResponse(webview, this.openAIConfig, command, null, kubectlresult.error);
            return;
        }

        // Sometimes there can be an error output even though the command returns a success status code.
        // This can happen when specifying an invalid namespace, for example.
        // For this reason we return stderr as well as stdout here.
        await this._sendResponse(webview, this.openAIConfig, command, kubectlresult.result.stdout, kubectlresult.result.stderr);
    }

    private async _sendResponse(
        webview: MessageSink<ToWebViewMsgDef>,
        openAIConfig: Errorable<OpenAIConfig>,
        command: string,
        output: string | null,
        errorMessage: string | null
    ) {
        let aiResponse: Observable<string> | null = null;
        if (errorMessage !== null) {
            if (failed(openAIConfig)) {
                this._updateAIKeyStatus(AIKeyStatus.Missing, null, webview);
            } else {
                const prompt = `I encountered the following error message when running 'kubectl ${command}': \n\n${errorMessage}\n\nWhat does this error mean, and how can I fix it?`
                const response = await getOpenAIResult(openAIConfig.result, prompt);
                if (failed(response)) {
                    this._updateAIKeyStatus(AIKeyStatus.Invalid, openAIConfig.result.apiKey, webview);
                } else {
                    this._updateAIKeyStatus(AIKeyStatus.Valid, null, webview);
                    aiResponse = response.result;
                }
            }
        }

        webview.postMessage({
            command: "runCommandResponse", parameters: {
                output,
                errorMessage
            }
        });

        if (aiResponse !== null) {
            webview.postMessage( {command: "startExplanation", parameters: undefined });
            aiResponse.subscribe({
                next: chunk => webview.postMessage({ command: "appendExplanation", parameters: {chunk} }),
                error: err => webview.postMessage({ command: "errorStreamingExplanation", parameters: {error: getErrorMessage(err)} }),
                complete: () => webview.postMessage({ command: "completeExplanation", parameters: undefined })
            });
        }
    }

    private async _handleAddCustomCommandRequest(name: string, command: string) {
        await addKubectlCustomCommand(name, command);
    }

    private async _handleDeleteCustomCommandRequest(name: string) {
        await deleteKubectlCustomCommand(name);
    }

    private _handleGetAIKeyStatus(webview: MessageSink<ToWebViewMsgDef>) {
        const invalidKey = succeeded(this.openAIConfig) && this.openAIKeyStatus === AIKeyStatus.Invalid ? this.openAIConfig.result.apiKey : null;
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus: this.openAIKeyStatus, invalidKey} });
    }

    private async _handleUpdateAIKeyRequest(apiKey: string, webview: MessageSink<ToWebViewMsgDef>) {
        await setOpenAIConfigApiKey(apiKey);
        this.openAIConfig = getOpenAIConfig();
        this._updateAIKeyStatus(AIKeyStatus.Unverified, null, webview);
    }

    private _updateAIKeyStatus(keyStatus: AIKeyStatus, invalidKey: string | null, webview: MessageSink<ToWebViewMsgDef>) {
        this.openAIKeyStatus = keyStatus;
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus, invalidKey} });
    }
}
