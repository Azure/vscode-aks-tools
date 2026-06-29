import * as path from "path";
import * as vscode from "vscode";
import { window } from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KickstartClusterDataProvider, KickstartClusterPanel } from "../../panels/KickstartClusterPanel";
import { ClusterLaunchContext } from "../../webview-contract/webviewDefinitions/kickstartCluster";
import { failed } from "../utils/errorable";
import { getGitApi } from "../utils/git";
import { getExtension } from "../utils/host";

export async function kickstartCluster(context: vscode.ExtensionContext, launchContextArg?: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration("aks.kickstart");
    if (!config.get<boolean>("enabled", true)) {
        window.showWarningMessage(
            "The Kickstart agent is disabled. Enable it via the 'aks.kickstart.enabled' setting.",
        );
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(`Could not sign in to Azure: ${sessionProvider.error}`);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        window.showErrorMessage(extension.error);
        return;
    }

    const launchContext = parseLaunchContext(launchContextArg);
    // Fall back to the local git repo name when no app name was supplied (e.g. command-palette launch).
    if (!launchContext.appName) {
        const repoName = await deriveAppNameFromGitRepo();
        if (repoName) {
            launchContext.appName = repoName;
        }
    }

    const panel = new KickstartClusterPanel(extension.result.extensionUri);
    const dataProvider = new KickstartClusterDataProvider(sessionProvider.result, context, launchContext);
    panel.show(dataProvider);
    // Give the view the full editor surface: close the bottom panel (terminal/output) and hide the
    // side bar. `maximizeEditorHideSidebar` alone leaves the terminal visible, so close it explicitly.
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
}

function parseLaunchContext(arg: unknown): ClusterLaunchContext {
    if (typeof arg === "string") {
        try {
            const parsed = JSON.parse(arg) as unknown;
            return parsed && typeof parsed === "object" ? (parsed as ClusterLaunchContext) : {};
        } catch {
            return {};
        }
    }
    if (arg && typeof arg === "object") {
        return arg as ClusterLaunchContext;
    }
    return {};
}

async function deriveAppNameFromGitRepo(): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return undefined;
    }

    const gitApi = getGitApi();
    if (failed(gitApi)) {
        return undefined;
    }

    const repository = await gitApi.result.openRepository(workspaceFolder.uri).catch(() => null);
    if (!repository) {
        return undefined;
    }

    const remotes = repository.state.remotes;
    const remote = remotes.find((r) => r.name === "origin") ?? remotes.find((r) => r.fetchUrl || r.pushUrl);
    const remoteUrl = remote?.fetchUrl || remote?.pushUrl;
    if (remoteUrl) {
        // Strip a trailing ".git" then split on both ":" and "/" so SSH (git@host:owner/repo) and
        // HTTPS (https://host/owner/repo) remotes both reduce to the trailing repository segment.
        const segments = remoteUrl
            .replace(/\.git$/, "")
            .split(/[:/]/)
            .filter((segment) => segment.length > 0);
        const repoName = segments[segments.length - 1];
        if (repoName) {
            return repoName;
        }
    }

    return path.basename(repository.rootUri.fsPath) || undefined;
}
