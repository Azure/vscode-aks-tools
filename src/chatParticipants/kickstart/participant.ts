import * as vscode from "vscode";
import { KICKSTART_PARTICIPANT_ID } from "./config";
import { defaultHandler } from "./handler";

export function registerKickstartParticipant(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(KICKSTART_PARTICIPANT_ID, defaultHandler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "aks-tools.png");
    participant.followupProvider = {
        provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
            const meta = result.metadata as
                | { command?: string; artifactCount?: number; cancelled?: boolean; error?: string }
                | undefined;
            const command = meta?.command;

            if (!command || command === "welcome") {
                return [
                    { prompt: "/start", label: "Start with current workspace" },
                    { prompt: "/sample", label: "Try a sample" },
                ];
            }

            if (command === "start" && meta?.artifactCount && meta.artifactCount > 0) {
                return [
                    {
                        prompt: "Build & push to ACR",
                        command: "aks.kickstart.buildAndPush",
                        label: "Build & push to ACR",
                    },
                    { prompt: "Deploy to AKS", command: "aks.kickstart.deploy", label: "Deploy to AKS" },
                ];
            }

            if (meta?.cancelled) {
                return [{ prompt: "/start", label: "Try again" }];
            }

            if (meta?.error) {
                return [{ prompt: "@kickstart help", label: "Get help" }];
            }

            return [];
        },
    };
    context.subscriptions.push(participant);
}
