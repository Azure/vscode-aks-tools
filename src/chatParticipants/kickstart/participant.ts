import * as vscode from "vscode";
import { KICKSTART_PARTICIPANT_ID } from "./config";
import { defaultHandler } from "./handler";

export function registerKickstartParticipant(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(KICKSTART_PARTICIPANT_ID, defaultHandler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "aks-tools.png");
    context.subscriptions.push(participant);
}
