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
import { DraftValidateDataProvider, DraftValidatePanel } from "../../panels/draft/DraftValidatePanel";
import { getExtension } from "../utils/host";
import { Errorable, failed, getErrorMessage, succeeded } from "../utils/errorable";
import { getDraftBinaryPath } from "../utils/helper/draftBinaryDownload";
import { DraftDeploymentDataProvider, DraftDeploymentPanel } from "../../panels/draft/DraftDeploymentPanel";
import * as k8s from "vscode-kubernetes-tools-api";
import { getDeploymentFilesToWrite } from "../utils/draft";
import { getGitApi } from "../utils/git";
import { DraftWorkflowDataProvider, DraftWorkflowPanel } from "../../panels/draft/DraftWorkflowPanel";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { Remote } from "../../types/git";
import { GitHubRepo } from "../../webview-contract/webviewDefinitions/draft/types";
import { ExistingFile } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { basename, extname, join } from "path";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { DraftCommandParamsType } from "./types";
import { getAksClusterTreeNode } from "../utils/clusters";
import path from "path";

export async function draftDockerfile(_context: IActionContext, target: unknown): Promise<void> {
    const params = getDraftDockerfileParams(target);
    const commonDependencies = await getCommonDraftDependencies(params?.workspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;
    const panel = new DraftDockerfilePanel(extension.extensionUri);
    const dataProvider = new DraftDockerfileDataProvider(
        workspaceFolder,
        draftBinaryPath,
        params?.initialLocation || "",
    );
    panel.show(dataProvider);
}

export async function draftDeployment(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const params = getDraftDeploymentParams(cloudExplorer, target);
    const commonDependencies = await getCommonDraftDependencies(params?.workspaceFolder);
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
        params?.initialLocation || "",
        params?.initialSelection || {},
    );
    panel.show(dataProvider);
}

export async function draftWorkflow(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const params = getDraftWorkflowParams(cloudExplorer, target);
    const commonDependencies = await getCommonDraftDependencies(params?.workspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    // The git API is used to infer the remote repositories associated with the selected workspace.
    // This allows it to provide only the relevant GitHub repositories for the user to pick from.
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

    // The Octokit instance is used to interact with the GitHub API. This allows the user to
    // select the relevant repository and branch to associate with the workflow file.
    const octokit = new Octokit({
        auth: `token ${session.result.accessToken}`,
    });

    const reposFromRemotes = await Promise.all(workspaceRepository.state.remotes.map((r) => getRepo(octokit, r)));
    const accessibleRepos = reposFromRemotes.filter((f) => f !== null) as GitHubRepo[];

    const workflowsUri = Uri.joinPath(workspaceFolder.uri, ".github", "workflows");
    let existingWorkflowFiles: ExistingFile[] = [];
    try {
        const files = await workspace.fs.readDirectory(workflowsUri);
        existingWorkflowFiles = files
            .filter((f) => f[1] === FileType.File)
            .map((f) => {
                const [name] = f;
                return {
                    name: basename(name, extname(name)),
                    path: join(".github", "workflows", name),
                };
            });
    } catch {
        // If the directory doesn't exist, that's fine - it just means there will be no existing workflow files.
    }

    const panel = new DraftWorkflowPanel(extension.extensionUri);
    const dataProvider = new DraftWorkflowDataProvider(
        sessionProvider.result,
        workspaceFolder,
        draftBinaryPath,
        kubectl,
        session.result,
        accessibleRepos,
        existingWorkflowFiles,
        params?.initialSelection || {},
    );
    panel.show(dataProvider);
}

export async function draftValidate(_context: IActionContext, target: unknown): Promise<void> {
    const params = getDraftDockerfileParams(target);
    const commonDependencies = await getCommonDraftDependencies(params?.workspaceFolder);
    if (commonDependencies === null) {
        return;
    }

    const { workspaceFolder, extension, draftBinaryPath } = commonDependencies;
    const panel = new DraftValidatePanel(extension.extensionUri);
    const dataProvider = new DraftValidateDataProvider(workspaceFolder, draftBinaryPath, params?.initialLocation || "");
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
        // Repo scope required to see public/private repos.
        // Reference for Github scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
        const scopes: string[] = ["repo"];
        const session = await authentication.getSession("github", scopes, { createIfNone: true });
        return { succeeded: true, result: session };
    } catch (e) {
        return { succeeded: false, error: `Failed to get GitHub authentication session: ${getErrorMessage(e)}` };
    }
}

async function getRepo(octokit: Octokit, remote: Remote): Promise<GitHubRepo | null> {
    const url = remote.fetchUrl || remote.pushUrl;
    if (!url) {
        return null;
    }

    const parts = url.replace(/\.git$/, "").split(/[:/]/); //Split on both : and /, Removes .git
    const [owner, repo] = parts.slice(-2);

    let response: RestEndpointMethodTypes["repos"]["get"]["response"];
    try {
        response = await octokit.rest.repos.get({ owner, repo });
    } catch {
        return null;
    }

    return {
        forkName: remote.name,
        url,
        gitHubRepoOwner: response.data.owner.login,
        gitHubRepoName: response.data.name,
        isFork: response.data.fork,
        defaultBranch: response.data.default_branch,
    };
}

function getDraftDockerfileParams(params: unknown): DraftCommandParamsType<"aks.draftDockerfile"> {
    if (params instanceof Uri) {
        const workspaceFolder = workspace.getWorkspaceFolder(params);
        if (!workspaceFolder) {
            return {};
        }

        const initialLocation = path.relative(workspaceFolder.uri.fsPath, params.fsPath);
        return {
            workspaceFolder: workspace.getWorkspaceFolder(params),
            initialLocation,
        };
    }

    return params as DraftCommandParamsType<"aks.draftDockerfile">;
}

function getDraftDeploymentParams(
    cloudExplorer: k8s.API<k8s.CloudExplorerV1>,
    params: unknown,
): DraftCommandParamsType<"aks.draftDeployment"> {
    if (params instanceof Uri) {
        const workspaceFolder = workspace.getWorkspaceFolder(params);
        if (!workspaceFolder) {
            return {};
        }

        const initialLocation = path.relative(workspaceFolder.uri.fsPath, params.fsPath);
        return {
            workspaceFolder,
            initialLocation,
        };
    }

    const clusterNode = getAksClusterTreeNode(params, cloudExplorer);
    if (succeeded(clusterNode)) {
        return {
            initialSelection: {
                subscriptionId: clusterNode.result.subscriptionId,
                clusterResourceGroup: clusterNode.result.resourceGroupName,
                clusterName: clusterNode.result.name,
            },
        };
    }

    return params as DraftCommandParamsType<"aks.draftDeployment">;
}

function getDraftWorkflowParams(
    cloudExplorer: k8s.API<k8s.CloudExplorerV1>,
    params: unknown,
): DraftCommandParamsType<"aks.draftWorkflow"> {
    const clusterNode = getAksClusterTreeNode(params, cloudExplorer);
    if (succeeded(clusterNode)) {
        return {
            initialSelection: {
                subscriptionId: clusterNode.result.subscriptionId,
                clusterResourceGroup: clusterNode.result.resourceGroupName,
                clusterName: clusterNode.result.name,
            },
        };
    }

    return params as DraftCommandParamsType<"aks.draftWorkflow">;
}
