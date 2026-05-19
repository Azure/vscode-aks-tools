import * as vscode from "vscode";
import { Errorable } from "../../commands/utils/errorable";
import { runInTerminal } from "./terminalTool";
import {
    GitHubRepo,
    PullRequestInfo,
    createPullRequest,
    generatePRBody,
    generatePRTitle,
    parseGitHubRemote,
} from "./githubHandoff";

export interface HandoffOptions {
    workspacePath: string;
    files: string[];
    branchName?: string;
    baseBranch?: string;
    title?: string;
    body?: string;
    token: vscode.CancellationToken;
    toolInvocationToken?: vscode.ChatParticipantToolToken;
}

export interface HandoffSuccess {
    pullRequest: PullRequestInfo;
    branch: string;
    repo: GitHubRepo;
}

function shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

async function execGit(
    workspacePath: string,
    args: string[],
    token: vscode.CancellationToken,
    toolInvocationToken?: vscode.ChatParticipantToolToken,
): Promise<Errorable<string>> {
    const command = `git ${args.map(shellEscape).join(" ")}`;
    return runInTerminal(command, workspacePath, token, toolInvocationToken);
}

async function getOriginRemoteUrl(
    workspacePath: string,
    token: vscode.CancellationToken,
    toolInvocationToken?: vscode.ChatParticipantToolToken,
): Promise<Errorable<string>> {
    const result = await execGit(workspacePath, ["remote", "get-url", "origin"], token, toolInvocationToken);
    if (!result.succeeded) return result;
    return { succeeded: true, result: result.result.trim() };
}

async function getGitHubAuthToken(): Promise<Errorable<string>> {
    try {
        const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
        if (!session) {
            return { succeeded: false, error: "GitHub authentication was declined." };
        }
        return { succeeded: true, result: session.accessToken };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { succeeded: false, error: `GitHub authentication failed: ${message}` };
    }
}

function defaultBranchName(): string {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    return `kickstart/aks-artifacts-${ts}`;
}

export async function handoffToPullRequest(options: HandoffOptions): Promise<Errorable<HandoffSuccess>> {
    if (options.files.length === 0) {
        return { succeeded: false, error: "No files to commit." };
    }

    const remoteResult = await getOriginRemoteUrl(options.workspacePath, options.token, options.toolInvocationToken);
    if (!remoteResult.succeeded) {
        return {
            succeeded: false,
            error: `Could not read git remote 'origin'. Is this a git repository? ${remoteResult.error}`,
        };
    }

    const repo = parseGitHubRemote(remoteResult.result);
    if (!repo) {
        return {
            succeeded: false,
            error: `Origin remote '${remoteResult.result}' is not a GitHub URL. Only GitHub repositories are supported.`,
        };
    }

    const authResult = await getGitHubAuthToken();
    if (!authResult.succeeded) {
        return authResult;
    }

    const branch = options.branchName ?? defaultBranchName();
    const base = options.baseBranch ?? "main";
    const title = options.title ?? generatePRTitle();
    const body = options.body ?? generatePRBody(options.files);

    const checkoutResult = await execGit(
        options.workspacePath,
        ["checkout", "-b", branch],
        options.token,
        options.toolInvocationToken,
    );
    if (!checkoutResult.succeeded) {
        return { succeeded: false, error: `git checkout -b ${branch} failed: ${checkoutResult.error}` };
    }

    const addResult = await execGit(
        options.workspacePath,
        ["add", "--", ...options.files],
        options.token,
        options.toolInvocationToken,
    );
    if (!addResult.succeeded) {
        return { succeeded: false, error: `git add failed: ${addResult.error}` };
    }

    const commitResult = await execGit(
        options.workspacePath,
        ["commit", "-m", title],
        options.token,
        options.toolInvocationToken,
    );
    if (!commitResult.succeeded) {
        return { succeeded: false, error: `git commit failed: ${commitResult.error}` };
    }

    const pushResult = await execGit(
        options.workspacePath,
        ["push", "-u", "origin", branch],
        options.token,
        options.toolInvocationToken,
    );
    if (!pushResult.succeeded) {
        return { succeeded: false, error: `git push failed: ${pushResult.error}` };
    }

    try {
        const pr = await createPullRequest({
            repo,
            branch,
            base,
            title,
            body,
            token: authResult.result,
        });
        return { succeeded: true, result: { pullRequest: pr, branch, repo } };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { succeeded: false, error: `Pull request creation failed: ${message}` };
    }
}
