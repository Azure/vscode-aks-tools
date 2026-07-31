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
import { ShellOptions, execFile, NonZeroExitCodeBehaviour } from "../../commands/utils/shell";
import { failed } from "../../commands/utils/errorable";

export class DraftValidatePanel extends BasePanel<"draftValidate"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftValidate", {
            validationResult: undefined,
        });
    }
}

export class DraftValidateDataProvider implements PanelDataProvider<"draftValidate"> {
    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly initialLocation: string,
    ) {}

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
        // The draftValidate command guarantees a valid file/folder selection before opening this panel.
        const manifestPath = `.${path.sep}${this.initialLocation}`;

        const execOptions: ShellOptions = {
            workingDir: this.workspaceFolder.uri.fsPath,
            // draft validate exits non-zero when it finds violations; those are results, not a failure.
            exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
        };

        const draftResult = await execFile(this.draftBinaryPath, ["validate", "--manifest", manifestPath], execOptions);
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
