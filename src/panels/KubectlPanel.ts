import { Uri } from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { failed } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { InitialState, PresetCommand, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kubectl";
import { addKubectlCustomCommand, deleteKubectlCustomCommand } from "../commands/utils/config";

export class KubectlPanel extends BasePanel<"kubectl"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kubectl");
    }
}

export class KubectlDataProvider implements PanelDataProvider<"kubectl"> {
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
            deleteCustomCommandRequest: args => this._handleDeleteCustomCommandRequest(args.name)
        };
    }

    private async _handleRunCommandRequest(command: string, webview: MessageSink<ToWebViewMsgDef>) {
        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);

        if (failed(kubectlresult)) {
            // TODO: Run some kind of AI processing over the command and error to generate an explanation.
            const explanation = undefined;
            webview.postMessage({
                command: "runCommandResponse", parameters: {
                    errorMessage: kubectlresult.error,
                    explanation
                }
            });

            return;
        }

        webview.postMessage({
            command: "runCommandResponse",
            parameters: {
                output: kubectlresult.result.stdout
            }
        });
    }

    private async _handleAddCustomCommandRequest(name: string, command: string) {
        await addKubectlCustomCommand(name, command);
    }

    private async _handleDeleteCustomCommandRequest(name: string) {
        await deleteKubectlCustomCommand(name);
    }
}
