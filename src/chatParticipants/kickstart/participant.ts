import * as vscode from "vscode";
import { KICKSTART_PARTICIPANT_ID } from "./config";
import { defaultHandler } from "./handler";
import { Phase } from "./state";

export function registerKickstartParticipant(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(KICKSTART_PARTICIPANT_ID, defaultHandler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "aks-tools.png");
    participant.followupProvider = {
        provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
            const meta = result.metadata as
                | {
                      command?: string;
                      artifactCount?: number;
                      cancelled?: boolean;
                      error?: string;
                  }
                | undefined;
            const command = meta?.command;

            // Handle welcome/no workspace state
            if (!command || command === "welcome") {
                return [
                    { prompt: "/start", label: "Start with current workspace" },
                    { prompt: "/sample", label: "Try a sample" },
                ];
            }

            // Handle errors - offer retry and status check
            if (meta?.error) {
                return [
                    { prompt: "retry", label: "Retry" },
                    { prompt: "status", label: "Check status" },
                ];
            }

            // Handle cancellation - offer to try again
            if (meta?.cancelled) {
                return [{ prompt: "analyze my project", label: "Try again" }];
            }

            // Handle reset - suggest analyzing
            if (command === "reset") {
                return [{ prompt: "analyze my project", label: "Analyze project" }];
            }

            // Handle status - no automatic followups after status check
            if (command === "status") {
                return [];
            }

            // Handle phase completions with phase-aware suggestions
            const phaseMatch = command?.match(/^phase-(\d+)$/);
            if (phaseMatch) {
                const phaseNum = parseInt(phaseMatch[1], 10);

                switch (phaseNum) {
                    case Phase.ANALYZE:
                        return [{ prompt: "configure Azure resources", label: "Configure Azure resources" }];

                    case Phase.CONFIGURE:
                        return [{ prompt: "generate deployment files", label: "Generate deployment files" }];

                    case Phase.PREPARE:
                        return [{ prompt: "build and push image", label: "Build & push image" }];

                    case Phase.BUILD:
                        return [{ prompt: "deploy to AKS", label: "Deploy to AKS" }];

                    case Phase.DEPLOY:
                        return [{ prompt: "verify deployment", label: "Verify deployment" }];

                    case Phase.VERIFY:
                        return [
                            { prompt: "check status", label: "Check status" },
                            { prompt: "start over", label: "Start over" },
                        ];

                    case Phase.COMPLETE:
                        return [
                            { prompt: "check status", label: "Check status" },
                            { prompt: "start over", label: "Start over" },
                        ];
                }
            }

            return [];
        },
    };
    context.subscriptions.push(participant);
}
