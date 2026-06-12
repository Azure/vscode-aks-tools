import { Uri, window } from "vscode";
import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { KICKSTART_SAMPLES, handoffToChat } from "../commands/aksKickstart/kickstartChat";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    GuidedSetupSelections,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";

export class KickstartGuidedSetupPanel extends BasePanel<"kickstartGuidedSetup"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kickstartGuidedSetup", {
            errorNotification: null,
        });
    }
}

export class KickstartGuidedSetupDataProvider implements PanelDataProvider<"kickstartGuidedSetup"> {
    getTitle(): string {
        return l10n.t("AKS Kickstart");
    }

    getInitialState(): InitialState {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return {
            samples: KICKSTART_SAMPLES,
            workspaceIsEmpty: !workspaceFolders || workspaceFolders.length === 0,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"kickstartGuidedSetup"> {
        return {
            finishRequest: true,
        };
    }

    getMessageHandler(_webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            finishRequest: (args) => this.handleFinish(args),
        };
    }

    private async handleFinish(selections: GuidedSetupSelections) {
        await handoffToChat(selections);
        window.showInformationMessage(l10n.t("Continuing AKS Kickstart in the chat view."));
    }
}
