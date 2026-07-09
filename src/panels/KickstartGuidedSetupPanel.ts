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
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kickstartGuidedSetup", {
            errorNotification: null,
            gitHubReposLoaded: null,
            gitHubReposError: null,
        });
    }
}

export class KickstartGuidedSetupDataProvider implements PanelDataProvider<"kickstartGuidedSetup"> {
    private authListener: vscode.Disposable | undefined;

    getTitle(): string {
        return l10n.t("AKS Kickstart");
    }

    getInitialState(): InitialState {
        return {
            samples: KICKSTART_SAMPLES,
            workspaceIsEmpty: !vscode.workspace.workspaceFolders?.length,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"kickstartGuidedSetup"> {
        return { finishRequest: true, listGitHubReposRequest: true };
    }

    /** Disposable to pass to `panel.show(...)` so the auth listener is cleaned up. */
    getProviderDisposable(): vscode.Disposable {
        return new vscode.Disposable(() => this.authListener?.dispose());
    }

    getMessageHandler(webview: ToWebviewMessageSink<"kickstartGuidedSetup">): MessageHandler<ToVsCodeMsgDef> {
        // Silently refresh whenever the user signs in/out or switches GitHub accounts.
        this.authListener = vscode.authentication.onDidChangeSessions((e) => {
            if (e.provider.id === "github") void this.fetchRepos(webview, { prompt: false });
        });

        return {
            finishRequest: (args) => this.handleFinish(args),
            // User-initiated, so we may prompt for the `repo` scope.
            listGitHubReposRequest: () => this.fetchRepos(webview, { prompt: true }),
        };
    }

    private async handleFinish(selections: GuidedSetupSelections) {
        await handoffToChat(selections);
        vscode.window.showInformationMessage(l10n.t("Continuing AKS Kickstart in the chat view."));
    }

    /**
     * Obtain a GitHub session with the `repo` scope and list the user's repos.
     * On user-initiated calls we prompt for the scope if it hasn't been granted;
     * background refreshes (auth-change events) stay silent.
     */
    private async fetchRepos(webview: ToWebviewMessageSink<"kickstartGuidedSetup">, opts: { prompt: boolean }) {
        let session: vscode.AuthenticationSession | undefined;
        try {
            session = await vscode.authentication.getSession(
                "github",
                ["repo"],
                opts.prompt ? { createIfNone: true } : { silent: true },
            );
        } catch {
            // Treat as "no session" below.
        }

        if (!session) {
            webview.postGitHubReposError({
                message: l10n.t(
                    "No GitHub account with `repo` access is signed in. Sign in via the Accounts menu to see your repositories.",
                ),
                signedInUser: null,
            });
            return;
        }

        const signedInUser = session.account?.label ?? null;

        try {
            const octokit = new Octokit({ auth: session.accessToken });
            const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                per_page: 100,
                sort: "updated",
                type: "owner",
            });
            webview.postGitHubReposLoaded({
                repos: data.map((r) => ({
                    fullName: r.full_name,
                    description: r.description,
                    cloneUrl: r.clone_url,
                    private: r.private,
                })),
                signedInUser,
            });
        } catch (e) {
            webview.postGitHubReposError({
                message: l10n.t("Failed to fetch GitHub repositories: {0}", String(e)),
                signedInUser,
            });
        }
    }
}
