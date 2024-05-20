import { AuthenticationSession, DocumentSymbol, Uri, WorkspaceFolder, window } from "vscode";
import path from "path";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    ExistingFile,
    InitialState,
    PickFilesIdentifier,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { Octokit } from "@octokit/rest";
import {
    AcrKey,
    ClusterKey,
    GitHubRepo,
    GitHubRepoKey,
    PickFilesRequestParams,
} from "../../webview-contract/webviewDefinitions/draft/types";
import { CreateParams, InitialSelection } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import { failed } from "../../commands/utils/errorable";
import { getClusterNamespaces } from "../../commands/utils/clusters";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { createWorkflowFile, getYamlDocumentAndSymbols, setWorkflowLanguage } from "../../commands/draft/workflowUtils";
import { ManifestsWorkflowEditor } from "../../commands/draft/manifestsWorkflowEditor";
import { WorkflowEditor } from "../../commands/draft/baseWorkflowEditor";
import { HelmWorkflowEditor } from "../../commands/draft/helmWorkflowEditor";
import { SelectionType, getSubscriptions } from "../../commands/utils/subscriptions";
import { getAcrRegistry, getRepositories } from "../../commands/utils/acrs";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getResources } from "../../commands/utils/azureResources";
import { launchDraftCommand } from "./commandUtils";

export class DraftWorkflowPanel extends BasePanel<"draftWorkflow"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftWorkflow", {
            pickFilesResponse: null,
            getBranchesResponse: null,
            getSubscriptionsResponse: null,
            getAcrsResponse: null,
            getRepositoriesResponse: null,
            getClustersResponse: null,
            getNamespacesResponse: null,
            createWorkflowResponse: null,
        });
    }
}

export class DraftWorkflowDataProvider implements PanelDataProvider<"draftWorkflow"> {
    readonly draftDirectory: string;
    readonly octokit: Octokit;
    constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly kubectl: APIAvailable<KubectlV1>,
        readonly githubSession: AuthenticationSession,
        readonly gitHubRepos: GitHubRepo[],
        readonly existingWorkflowFiles: ExistingFile[],
        readonly initialSelection: InitialSelection,
    ) {
        this.draftDirectory = path.dirname(draftBinaryPath);
        this.octokit = new Octokit({
            auth: `token ${githubSession.accessToken}`,
        });
    }

    getTitle(): string {
        return `Draft GitHub Workflow in ${this.workspaceFolder.name}`;
    }

    getInitialState(): InitialState {
        return {
            workspaceConfig: {
                name: this.workspaceFolder.name,
                fullPath: this.workspaceFolder.uri.fsPath,
                pathSeparator: path.sep,
            },
            existingWorkflowFiles: this.existingWorkflowFiles,
            repos: this.gitHubRepos,
            initialSelection: this.initialSelection,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftWorkflow"> {
        return {
            pickFilesRequest: false,
            getBranchesRequest: false,
            getSubscriptionsRequest: false,
            getAcrsRequest: false,
            getRepositoriesRequest: false,
            getClustersRequest: false,
            getNamespacesRequest: false,
            createWorkflowRequest: true,
            openFileRequest: false,
            launchDraftDockerfile: false,
            launchDraftDeployment: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickFilesRequest: (args) => this.handlePickFilesRequest(args, webview),
            getBranchesRequest: (args) => this.handleGetBranchesRequest(args, webview),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getAcrsRequest: (key) => this.handleGetAcrsRequest(key.subscriptionId, webview),
            getRepositoriesRequest: (key) =>
                this.handleGetRepositoriesRequest(key.subscriptionId, key.resourceGroup, key.acrName, webview),
            getClustersRequest: (key) => this.handleGetClustersRequest(key.subscriptionId, webview),
            getNamespacesRequest: (key) =>
                this.handleGetNamespacesRequest(key.subscriptionId, key.resourceGroup, key.clusterName, webview),
            createWorkflowRequest: (args) => this.handleCreateWorkflowRequest(args, webview),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
            launchDraftDockerfile: () =>
                launchDraftCommand("aks.draftDockerfile", {
                    workspaceFolder: this.workspaceFolder,
                }),
            launchDraftDeployment: () =>
                launchDraftCommand("aks.draftDeployment", {
                    workspaceFolder: this.workspaceFolder,
                }),
        };
    }

    private async handlePickFilesRequest(
        args: PickFilesRequestParams<PickFilesIdentifier>,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const results = await window.showOpenDialog({
            canSelectFiles: args.options.type === "file",
            canSelectFolders: args.options.type === "directory",
            canSelectMany: args.options.canSelectMany || false,
            defaultUri: args.options.defaultPath ? Uri.file(args.options.defaultPath) : undefined,
        });

        if (!results || results.length === 0) return;

        const paths = results.map((uri) => path.relative(this.workspaceFolder.uri.fsPath, uri.fsPath)) as [
            string,
            ...string[],
        ];
        webview.postPickFilesResponse({
            identifier: args.identifier,
            paths,
        });
    }

    private async handleGetBranchesRequest(repoKey: GitHubRepoKey, webview: MessageSink<ToWebViewMsgDef>) {
        const repo = this.gitHubRepos.find(
            (r) => r.gitHubRepoOwner === repoKey.gitHubRepoOwner && r.gitHubRepoName === repoKey.gitHubRepoName,
        );

        if (!repo) {
            window.showErrorMessage(
                `GitHub repository ${repoKey.gitHubRepoOwner}/${repoKey.gitHubRepoName} not found.`,
            );
            return;
        }

        const branches = await this.octokit.repos.listBranches({
            owner: repoKey.gitHubRepoOwner,
            repo: repoKey.gitHubRepoName,
        });

        webview.postGetBranchesResponse({
            gitHubRepoOwner: repoKey.gitHubRepoOwner,
            gitHubRepoName: repoKey.gitHubRepoName,
            branches: branches.data.map((b) => b.name),
        });
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptions = await getSubscriptions(this.sessionProvider, SelectionType.AllIfNoFilters);
        if (failed(azureSubscriptions)) {
            window.showErrorMessage(azureSubscriptions.error);
            return;
        }

        const subscriptions = azureSubscriptions.result.map((subscription) => ({
            id: subscription.subscriptionId,
            name: subscription.displayName,
        }));

        webview.postGetSubscriptionsResponse(subscriptions);
    }

    private async handleGetAcrsRequest(subscriptionId: string, webview: MessageSink<ToWebViewMsgDef>) {
        const acrs = await getResources(this.sessionProvider, subscriptionId, "Microsoft.ContainerRegistry/registries");
        if (failed(acrs)) {
            window.showErrorMessage(acrs.error);
            return;
        }

        const acrKeys: AcrKey[] = acrs.result
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((acr) => ({
                subscriptionId,
                resourceGroup: acr.resourceGroup,
                acrName: acr.name,
            }));

        webview.postGetAcrsResponse({ subscriptionId, acrKeys });
    }

    private async handleGetRepositoriesRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const registry = await getAcrRegistry(this.sessionProvider, subscriptionId, resourceGroup, acrName);
        if (failed(registry)) {
            window.showErrorMessage(registry.error);
            return;
        }

        const repositoryNames = await getRepositories(this.sessionProvider, registry.result);
        if (failed(repositoryNames)) {
            window.showErrorMessage(repositoryNames.error);
            return;
        }

        webview.postGetRepositoriesResponse({
            subscriptionId,
            resourceGroup,
            acrName,
            repositoryNames: repositoryNames.result,
        });
    }

    private async handleGetClustersRequest(subscriptionId: string, webview: MessageSink<ToWebViewMsgDef>) {
        const clusters = await getResources(
            this.sessionProvider,
            subscriptionId,
            "Microsoft.ContainerService/managedClusters",
        );
        if (failed(clusters)) {
            window.showErrorMessage(clusters.error);
            return;
        }

        const clusterKeys: ClusterKey[] = clusters.result
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((acr) => ({
                subscriptionId,
                resourceGroup: acr.resourceGroup,
                clusterName: acr.name,
            }));

        webview.postGetClustersResponse({ subscriptionId, clusterKeys });
    }

    private async handleGetNamespacesRequest(
        subscriptionId: string,
        resourceGroup: string,
        clusterName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const namespacesResult = await getClusterNamespaces(
            this.sessionProvider,
            this.kubectl,
            subscriptionId,
            resourceGroup,
            clusterName,
        );
        if (failed(namespacesResult)) {
            window.showErrorMessage(namespacesResult.error);
            return;
        }

        webview.postGetNamespacesResponse({
            subscriptionId,
            resourceGroup,
            clusterName,
            namespaceNames: namespacesResult.result,
        });
    }

    private async handleCreateWorkflowRequest(createParams: CreateParams, webview: MessageSink<ToWebViewMsgDef>) {
        const fileUri = await createWorkflowFile(
            this.workspaceFolder,
            createParams.workflowName,
            createParams.deploymentParams.deploymentType,
        );
        if (failed(fileUri)) {
            window.showErrorMessage(fileUri.error);
            return;
        }

        const docAndSymbols = await getYamlDocumentAndSymbols(fileUri.result);
        if (failed(docAndSymbols)) {
            window.showErrorMessage(docAndSymbols.error);
            return;
        }

        const { document, symbols } = docAndSymbols.result;

        const workflowEditor = getWorkflowEditor(createParams, fileUri.result, symbols);

        await workflowEditor.update();
        await document.save();
        await setWorkflowLanguage(document);

        webview.postCreateWorkflowResponse([
            ...this.existingWorkflowFiles,
            {
                name: createParams.workflowName,
                path: path.relative(this.workspaceFolder.uri.fsPath, fileUri.result.fsPath),
            },
        ]);
    }

    private handleOpenFileRequest(relativeFilePath: string) {
        const filePath = path.join(this.workspaceFolder.uri.fsPath, relativeFilePath);
        window.showTextDocument(Uri.file(filePath));
    }
}

function getWorkflowEditor(createParams: CreateParams, fileUri: Uri, symbols: DocumentSymbol[]): WorkflowEditor {
    switch (createParams.deploymentParams.deploymentType) {
        case "manifests":
            return new ManifestsWorkflowEditor(symbols, fileUri, createParams);
        case "helm":
            return new HelmWorkflowEditor(symbols, fileUri, createParams);
    }
}
