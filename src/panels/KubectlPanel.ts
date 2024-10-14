import { Uri } from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import {
    InitialState,
    PresetCommand,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kubectl";
import { addKubectlCustomCommand, deleteKubectlCustomCommand } from "../commands/utils/config";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

export class KubectlPanel extends BasePanel<"kubectl"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kubectl", {
            runCommandResponse: null,
        });
    }
}

export class KubectlDataProvider implements PanelDataProvider<"kubectl"> {
    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly clusterName: string,
        readonly customCommands: PresetCommand[],
        readonly initialCommand?: string
    ) { }

    getTitle(): string {
        return `Run Kubectl on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            customCommands: this.customCommands,
            initialCommand: this.initialCommand
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"kubectl"> {
        return {
            runCommandRequest: true,
            addCustomCommandRequest: true,
            deleteCustomCommandRequest: true,
            initialCommandRequest: true
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            runCommandRequest: (args) => this.handleRunCommandRequest(args.command, webview),
            addCustomCommandRequest: (args) => this.handleAddCustomCommandRequest(args.name, args.command),
            deleteCustomCommandRequest: (args) => this.handleDeleteCustomCommandRequest(args.name),
            initialCommandRequest: (args) => this.handleRunCommandRequest(args.initialCommand, webview),
        };
    }

    private async handleRunCommandRequest(command: string, webview: MessageSink<ToWebViewMsgDef>) {
        if (command.includes("kubectl")) {
            command = command.replace("kubectl", "").trim();
        }

        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);

        if (failed(kubectlresult)) {
            await this.sendResponse(webview, command, null, kubectlresult.error);
            return;
        }

        // Sometimes there can be an error output even though the command returns a success status code.
        // This can happen when specifying an invalid namespace, for example.
        // For this reason we return stderr as well as stdout here.
        await this.sendResponse(webview, command, kubectlresult.result.stdout, kubectlresult.result.stderr);
    }

    private async sendResponse(
        webview: MessageSink<ToWebViewMsgDef>,
        _command: string,
        output: string | null,
        errorMessage: string | null,
    ) {
        webview.postRunCommandResponse({ output, errorMessage });
    }

    private async handleAddCustomCommandRequest(name: string, command: string) {
        await addKubectlCustomCommand(name, command);
    }

    private async handleDeleteCustomCommandRequest(name: string) {
        await deleteKubectlCustomCommand(name);
    }
}
