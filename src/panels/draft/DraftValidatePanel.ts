import { Uri, WorkspaceFolder, window } from "vscode";
import path from "path";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftValidate";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { ShellOptions, exec } from "../../commands/utils/shell";
import { failed } from "../../commands/utils/errorable";

export class DraftValidatePanel extends BasePanel<"draftValidate"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftValidate", {
            validationResult: undefined,
        });
    }
}

export class DraftValidateDataProvider implements PanelDataProvider<"draftValidate"> {
    readonly draftDirectory: string;
    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly initialLocation: string,
    ) {
        this.draftDirectory = path.dirname(draftBinaryPath);
    }

    getTitle(): string {
        return `Draft Validate in ${this.workspaceFolder.name}`;
    }

    getInitialState(): InitialState {
        return {
            validationResults: "Initializing validation...",
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftValidate"> {
        return {
            createDraftValidateRequest: true,
        };
    }

    //Messages from Webview to Vscode
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            createDraftValidateRequest: () => this.handleDraftValidateRequest(webview),
        };
    }

    private async handleDraftValidateRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const command = `draft validate --manifest .${path.sep}${this.initialLocation}`;

        const execOptions: ShellOptions = {
            workingDir: this.workspaceFolder.uri.fsPath,
            envPaths: [this.draftDirectory],
        };

        const draftResult = await exec(command, execOptions);
        if (failed(draftResult)) {
            window.showErrorMessage(draftResult.error);
            return;
        }

        const validationResults = draftResult.result.stdout;

        webview.postValidationResult({ result: validationResults });
    }
}
