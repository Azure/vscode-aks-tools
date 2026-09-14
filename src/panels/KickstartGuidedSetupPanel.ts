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

/** GitHub's max page size for the repo list endpoint. */
const REPO_PAGE_SIZE = 100;
/** Cap total pages so users with thousands of repos don't stall the wizard. */
const MAX_REPO_PAGES = 3;

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
            finishRequest: (args) => this.handleFinish(webview, args),
            // User-initiated calls pass `prompt: true`, so we may prompt for the `repo` scope.
            listGitHubReposRequest: (args) => this.fetchRepos(webview, { prompt: args.prompt }),
        };
    }

    private async handleFinish(
        webview: ToWebviewMessageSink<"kickstartGuidedSetup">,
        selections: GuidedSetupSelections,
    ) {
        try {
            await handoffToChat(selections);
            vscode.window.showInformationMessage(l10n.t("Continuing AKS Kickstart in the chat view."));
        } catch (e) {
            webview.postErrorNotification({
                message: l10n.t("Couldn't open the Kickstart chat: {0}", String(e)),
            });
        }
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
                message: l10n.t("Sign in to GitHub to browse your repositories, or paste a repository URL below."),
                signedInUser: null,
                needsSignIn: true,
            });
            return;
        }

        const signedInUser = session.account?.label ?? null;

        try {
            const octokit = new Octokit({ auth: session.accessToken });

            // `pushed` (not `updated`): GitHub bumps `updated_at` on any repo-record change — stars,
            // description, rename — so it reads as random. `type: "owner"` keeps the list to the
            // user's own repos; org membership can pull in thousands they've never touched.
            const repos = [];
            for (let page = 1; page <= MAX_REPO_PAGES; page++) {
                const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                    per_page: REPO_PAGE_SIZE,
                    page,
                    sort: "pushed",
                    direction: "desc",
                    type: "owner",
                });
                repos.push(
                    ...data.map((r) => ({
                        fullName: r.full_name,
                        description: r.description,
                        cloneUrl: r.clone_url,
                        private: r.private,
                        pushedAt: r.pushed_at ?? null,
                    })),
                );
                if (data.length < REPO_PAGE_SIZE) {
                    break;
                }
            }

            webview.postGitHubReposLoaded({
                repos,
                signedInUser,
                hasMore: repos.length >= REPO_PAGE_SIZE * MAX_REPO_PAGES,
            });
        } catch (e) {
            webview.postGitHubReposError({
                message: l10n.t("Failed to fetch GitHub repositories: {0}", String(e)),
                signedInUser,
                needsSignIn: false,
            });
        }
    }
}
