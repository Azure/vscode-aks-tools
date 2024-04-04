import {
    authentication,
    Extension,
    ExtensionContext,
    WorkspaceFolder,
    window,
    workspace,
    AuthenticationSession,
    Uri,
    FileType,
} from "vscode";
import { DraftDockerfileDataProvider, DraftDockerfilePanel } from "../../panels/draft/DraftDockerfilePanel";
import { getExtension } from "../utils/host";
import { Errorable, failed, getErrorMessage } from "../utils/errorable";
import { getDraftBinaryPath } from "../utils/helper/draftBinaryDownload";
import { DraftDeploymentDataProvider, DraftDeploymentPanel } from "../../panels/draft/DraftDeploymentPanel";
import * as k8s from "vscode-kubernetes-tools-api";
import { getDeploymentFilesToWrite } from "../utils/draft";
import { getGitApi } from "../utils/git";
import { DraftWorkflowDataProvider, DraftWorkflowPanel } from "../../panels/draft/DraftWorkflowPanel";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { Remote } from "../../types/git";
import { ForkInfo } from "../../webview-contract/webviewDefinitions/draft/types";
import { ExistingFile } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { basename, join } from "path";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export async function draftDockerfile(
    _context: IActionContext,
    suppliedWorkspaceFolder?: WorkspaceFolder,
): Promise<void> {
    const commonDependencies = await getCommonDraftDependencies(suppliedWorkspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;
    const panel = new DraftDockerfilePanel(extension.extensionUri);
    const dataProvider = new DraftDockerfileDataProvider(workspaceFolder, draftBinaryPath);
    panel.show(dataProvider);
}

export async function draftDeployment(
    _context: IActionContext,
    suppliedWorkspaceFolder?: WorkspaceFolder,
): Promise<void> {
    const commonDependencies = await getCommonDraftDependencies(suppliedWorkspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        window.showErrorMessage(`Kubectl is unavailable.`);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const deploymentFilesToWrite = await getDeploymentFilesToWrite(draftBinaryPath);
    if (failed(deploymentFilesToWrite)) {
        window.showErrorMessage(deploymentFilesToWrite.error);
        return;
    }

    const panel = new DraftDeploymentPanel(extension.extensionUri);
    const dataProvider = new DraftDeploymentDataProvider(
        sessionProvider.result,
        workspaceFolder,
        draftBinaryPath,
        kubectl,
        deploymentFilesToWrite.result,
    );
    panel.show(dataProvider);
}

export async function draftWorkflow(
    _context: IActionContext,
    suppliedWorkspaceFolder?: WorkspaceFolder,
): Promise<void> {
    const commonDependencies = await getCommonDraftDependencies(suppliedWorkspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const gitApi = getGitApi();
    if (failed(gitApi)) {
        window.showErrorMessage(gitApi.error);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        window.showErrorMessage(`Kubectl is unavailable.`);
        return;
    }

    const workspaceRepository = await gitApi.result.openRepository(workspaceFolder.uri);
    if (!workspaceRepository) {
        window.showErrorMessage("The workspace is not a git repository.");
        return;
    }

    const session = await getGitHubAuthenticationSession();
    if (failed(session)) {
        window.showErrorMessage(session.error);
        return;
    }

    const octokit = new Octokit({
        auth: `token ${session.result.accessToken}`,
    });

    const allForks = await Promise.all(workspaceRepository.state.remotes.map((r) => getForkInfo(octokit, r)));
    const forks = allForks.filter((f) => f !== null) as ForkInfo[];

    const workflowsUri = Uri.joinPath(workspaceFolder.uri, ".github", "workflows");
    let existingWorkflowFiles: ExistingFile[] = [];
    try {
        const files = await workspace.fs.readDirectory(workflowsUri);
        existingWorkflowFiles = files
            .filter((f) => f[1] === FileType.File)
            .map((f) => {
                const [name] = f;
                return {
                    name: basename(name),
                    path: join(".github", "workflows", name),
                };
            });
    } catch (e) {
        // If the directory doesn't exist, that's fine - it just means there will be no existing workflow files.
    }

    const panel = new DraftWorkflowPanel(extension.extensionUri);
    const dataProvider = new DraftWorkflowDataProvider(
        sessionProvider.result,
        workspaceFolder,
        draftBinaryPath,
        kubectl,
        workspaceRepository,
        session.result,
        forks,
        existingWorkflowFiles,
    );
    panel.show(dataProvider);
}

async function getCommonDraftDependencies(
    suppliedWorkspaceFolder?: WorkspaceFolder,
): Promise<DraftDependencies | null> {
    let workspaceFolder: WorkspaceFolder;
    if (suppliedWorkspaceFolder) {
        workspaceFolder = suppliedWorkspaceFolder;
    } else {
        if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
            window.showErrorMessage("You must have a workspace open to run Draft commands.");
            return null;
        }

        workspaceFolder = workspace.workspaceFolders[0];
        if (workspace.workspaceFolders.length > 1) {
            const pickResult = await window.showWorkspaceFolderPick({
                placeHolder: "Select a workspace folder to run this command.",
            });
            if (!pickResult) return null;
            workspaceFolder = pickResult;
        }
    }

    const extension = getExtension();
    if (failed(extension)) {
        window.showErrorMessage(extension.error);
        return null;
    }

    const draftBinaryPath = await getDraftBinaryPath();
    if (failed(draftBinaryPath)) {
        window.showErrorMessage(draftBinaryPath.error);
        return null;
    }

    return { workspaceFolder, extension: extension.result, draftBinaryPath: draftBinaryPath.result };
}

type DraftDependencies = {
    workspaceFolder: WorkspaceFolder;
    extension: Extension<ExtensionContext>;
    draftBinaryPath: string;
};

async function getGitHubAuthenticationSession(): Promise<Errorable<AuthenticationSession>> {
    try {
        const session = await authentication.getSession(
            "github",
            ["repo", "user:email", "workflow", "read:org", "actions:read"],
            { createIfNone: true },
        );
        return { succeeded: true, result: session };
    } catch (e) {
        return { succeeded: false, error: `Failed to get GitHub authentication session: ${getErrorMessage(e)}` };
    }
}

async function getForkInfo(octokit: Octokit, remote: Remote): Promise<ForkInfo | null> {
    const url = remote.fetchUrl || remote.pushUrl;
    if (!url) {
        return null;
    }

    const [owner, repo] = url
        .replace(/\.git$/, "")
        .split("/")
        .slice(-2);
    let response: RestEndpointMethodTypes["repos"]["get"]["response"];
    try {
        response = await octokit.repos.get({ owner, repo });
    } catch (e) {
        return null;
    }

    return {
        name: remote.name,
        url,
        owner: response.data.owner.login,
        repo: response.data.name,
        isFork: response.data.fork,
        defaultBranch: response.data.default_branch,
    };
}
