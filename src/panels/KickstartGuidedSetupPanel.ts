import { Uri, window } from "vscode";
import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { Octokit } from "@octokit/rest";
import { KICKSTART_SAMPLES, handoffToChat } from "../commands/aksKickstart/kickstartChat";
import { MessageHandler } from "../webview-contract/messaging";
import {
    GuidedSetupSelections,
    InitialState,
    ToVsCodeMsgDef,
} from "../webview-contract/webviewDefinitions/kickstartGuidedSetup";
import { TelemetryDefinition, ToWebviewMessageSink } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";

export class KickstartGuidedSetupPanel extends BasePanel<"kickstartGuidedSetup"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kickstartGuidedSetup", {
            errorNotification: null,
            gitHubReposLoaded: null,
            gitHubReposError: null,
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
            listGitHubReposRequest: true,
        };
    }

    getMessageHandler(webview: ToWebviewMessageSink<"kickstartGuidedSetup">): MessageHandler<ToVsCodeMsgDef> {
        // Refresh the repo list automatically whenever the user signs in,
        // signs out, or switches GitHub accounts in VS Code.
        vscode.authentication.onDidChangeSessions((e) => {
            if (e.provider.id === "github") {
                void this.fetchRepos(webview);
            }
        });

        return {
            finishRequest: (args) => this.handleFinish(args),
            listGitHubReposRequest: () => this.fetchRepos(webview),
        };
    }

    private async handleFinish(selections: GuidedSetupSelections) {
        await handoffToChat(selections);
        window.showInformationMessage(l10n.t("Continuing AKS Kickstart in the chat view."));
    }

    private async fetchRepos(webview: ToWebviewMessageSink<"kickstartGuidedSetup">) {
        // Use whichever GitHub account is signed into VS Code. `createIfNone: false`
        // means we never prompt — sign-in happens via the Accounts menu.
        let session: vscode.AuthenticationSession | undefined;
        try {
            session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: false });
        } catch {
            session = undefined;
        }

        if (!session) {
            webview.postGitHubReposError({
                message: l10n.t(
                    "No GitHub account is signed in to VS Code. Sign in via the Accounts menu to see your repositories.",
                ),
            });
            return;
        }

        try {
            // type: "owner" restricts the list to repos owned by the signed-in user.
            const octokit = new Octokit({ auth: session.accessToken });
            const { data: apiRepos } = await octokit.rest.repos.listForAuthenticatedUser({
                per_page: 100,
                sort: "updated",
                type: "owner",
            });
            webview.postGitHubReposLoaded({
                repos: apiRepos.map((r) => ({
                    fullName: r.full_name,
                    description: r.description,
                    cloneUrl: r.clone_url,
                    private: r.private,
                })),
                signedInUser: session.account?.label ?? null,
            });
        } catch (e) {
            webview.postGitHubReposError({
                message: l10n.t("Failed to fetch GitHub repositories: {0}", String(e)),
            });
        }
    }
}
