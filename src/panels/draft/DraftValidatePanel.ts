import { l10n, Uri, WorkspaceFolder, window } from "vscode";
import path from "path";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftValidate";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { ShellOptions, exec, NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
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
        return l10n.t(`Run Deployment Safeguards in {0}`, this.workspaceFolder.name);
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
        const location = this.initialLocation?.trim();
        if (!location) {
            webview.postValidationResult({
                result: l10n.t(
                    "No manifest path was provided. Right-click a manifest file or your manifests folder and run Draft validate.",
                ),
            });
            return;
        }

        const manifestPath = `.${path.sep}${location}`;
        const command = `draft validate --manifest "${manifestPath}"`;

        const execOptions: ShellOptions = {
            workingDir: this.workspaceFolder.uri.fsPath,
            envPaths: [this.draftDirectory],
            // draft validate exits non-zero when it finds violations; those are results, not a failure.
            exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
        };

        const draftResult = await exec(command, execOptions);
        if (failed(draftResult)) {
            window.showErrorMessage(draftResult.error);
            return;
        }

        // Findings can appear on stdout or stderr depending on the outcome; surface both.
        const { stdout, stderr } = draftResult.result;
        const validationResults =
            [stdout, stderr]
                .map((s) => s?.trim())
                .filter((s) => s)
                .join("\n\n") || l10n.t("Draft validate returned no output.");

        webview.postValidationResult({ result: validationResults });
    }
}
