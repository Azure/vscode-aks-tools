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
import { Repository } from "../../types/git";
import { Octokit } from "@octokit/rest";
import { ForkInfo, PickFilesRequestParams } from "../../webview-contract/webviewDefinitions/draft/types";
import { CreateParams } from "../../webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    AzureAccountExtensionApi,
    getAcrClient,
    getAcrMgtClient,
    getAksClient,
    getAzureSubscription,
    getAzureSubscriptions,
    getResourceManagementClient,
    listAll,
} from "../../commands/utils/azureAccount";
import { failed, map as errmap } from "../../commands/utils/errorable";
import { ClusterContext, getKubeconfigYaml } from "../../commands/utils/clusters";
import { withOptionalTempFile } from "../../commands/utils/tempfile";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { createWorkflowFile, getYamlDocumentAndSymbols, setWorkflowLanguage } from "../../commands/draft/workflowUtils";
import { ManifestsWorkflowEditor } from "../../commands/draft/manifestsWorkflowEditor";
import { WorkflowEditor } from "../../commands/draft/baseWorkflowEditor";
import { HelmWorkflowEditor } from "../../commands/draft/helmWorkflowEditor";

export class DraftWorkflowPanel extends BasePanel<"draftWorkflow"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftWorkflow", {
            pickFilesResponse: null,
            getBranchesResponse: null,
            getSubscriptionsResponse: null,
            getResourceGroupsResponse: null,
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
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly azAccount: AzureAccountExtensionApi,
        readonly kubectl: APIAvailable<KubectlV1>,
        readonly gitRepo: Repository,
        readonly githubSession: AuthenticationSession,
        readonly forks: ForkInfo[],
        readonly existingWorkflowFiles: ExistingFile[],
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
            forks: this.forks,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftWorkflow"> {
        return {
            pickFilesRequest: false,
            getBranchesRequest: false,
            getSubscriptionsRequest: false,
            getResourceGroupsRequest: false,
            getAcrsRequest: false,
            getRepositoriesRequest: false,
            getClustersRequest: false,
            getNamespacesRequest: false,
            createWorkflowRequest: true,
            openFileRequest: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickFilesRequest: (args) => this.handlePickFilesRequest(args, webview),
            getBranchesRequest: (args) => this.handleGetBranchesRequest(args.forkName, webview),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getResourceGroupsRequest: (key) => this.handleGetResourceGroupsRequest(key.subscriptionId, webview),
            getAcrsRequest: (key) => this.handleGetAcrsRequest(key.subscriptionId, key.resourceGroup, webview),
            getRepositoriesRequest: (key) =>
                this.handleGetRepositoriesRequest(key.subscriptionId, key.resourceGroup, key.acrName, webview),
            getClustersRequest: (key) => this.handleGetClustersRequest(key.subscriptionId, key.resourceGroup, webview),
            getNamespacesRequest: (key) =>
                this.handleGetNamespacesRequest(key.subscriptionId, key.resourceGroup, key.clusterName, webview),
            createWorkflowRequest: (args) => this.handleCreateWorkflowRequest(args, webview),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
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

    private async handleGetBranchesRequest(forkName: string, webview: MessageSink<ToWebViewMsgDef>) {
        const fork = this.forks.find((f) => f.name === forkName);
        if (!fork) {
            window.showErrorMessage(`Fork ${forkName} not found.`);
            return;
        }

        const branches = await this.octokit.repos.listBranches({
            owner: fork.owner,
            repo: fork.repo,
        });

        webview.postGetBranchesResponse({
            forkName,
            branches: branches.data.map((b) => b.name),
        });
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptions = await getAzureSubscriptions(this.azAccount);
        const subscriptions = azureSubscriptions.map((subscription) => ({
            id: subscription.subscription.subscriptionId || "",
            name: subscription.subscription.displayName || "",
        }));
        webview.postGetSubscriptionsResponse(subscriptions);
    }

    private async handleGetResourceGroupsRequest(subscriptionId: string, webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscription = await getAzureSubscription(this.azAccount, subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const resourceMgtClient = getResourceManagementClient(azureSubscription.result);

        const resourceGroupsResult = await listAll(resourceMgtClient.resourceGroups.list());
        const groups = resourceGroupsResult.map((resourceGroup) => resourceGroup.name || "").sort();
        webview.postGetResourceGroupsResponse({ subscriptionId, groups });
    }

    private async handleGetAcrsRequest(
        subscriptionId: string,
        resourceGroup: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const azureSubscription = await getAzureSubscription(this.azAccount, subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const acrMgtClient = getAcrMgtClient(azureSubscription.result);
        const acrsResult = await listAll(acrMgtClient.registries.listByResourceGroup(resourceGroup));
        const acrNames = acrsResult.map((acr) => acr.name || "").sort();
        webview.postGetAcrsResponse({ subscriptionId, resourceGroup, acrNames });
    }

    private async handleGetRepositoriesRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const azureSubscription = await getAzureSubscription(this.azAccount, subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const acrClient = await getAcrClient(azureSubscription.result, resourceGroup, acrName);
        if (failed(acrClient)) {
            window.showErrorMessage(acrClient.error);
            return;
        }
        const repositoryNames = await listAll(acrClient.result.listRepositoryNames());
        webview.postGetRepositoriesResponse({ subscriptionId, resourceGroup, acrName, repositoryNames });
    }

    private async handleGetClustersRequest(
        subscriptionId: string,
        resourceGroup: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const azureSubscription = await getAzureSubscription(this.azAccount, subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const aksClient = getAksClient(azureSubscription.result);
        const clustersResult = await listAll(aksClient.managedClusters.listByResourceGroup(resourceGroup));
        const clusterNames = clustersResult.map((cluster) => cluster.name || "");
        webview.postGetClustersResponse({ subscriptionId, resourceGroup, clusterNames });
    }

    private async handleGetNamespacesRequest(
        subscriptionId: string,
        resourceGroup: string,
        clusterName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const azureSubscription = await getAzureSubscription(this.azAccount, subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const aksClient = getAksClient(azureSubscription.result);
        const clusterResult = await aksClient.managedClusters.get(resourceGroup, clusterName);

        // TODO: Move cluster context related functionality somewhere shared to reduce duplication
        // (this will probably involve some reorganization of the responsibilities of `clusters.ts`).
        const clusterContext: ClusterContext = {
            name: clusterName,
            resourceGroupName: resourceGroup,
            subscription: {
                subscriptionId,
                credentials: azureSubscription.result.session.credentials2!,
                environment: azureSubscription.result.session.environment,
            },
        };

        const kubeconfig = await getKubeconfigYaml(clusterContext, clusterResult);
        if (failed(kubeconfig)) {
            window.showErrorMessage(kubeconfig.error);
            return;
        }

        const namespacesResult = await withOptionalTempFile(kubeconfig.result, "yaml", async (kubeconfigPath) => {
            const command = `get namespace --no-headers -o custom-columns=":metadata.name"`;
            const output = await invokeKubectlCommand(this.kubectl, kubeconfigPath, command);
            return errmap(output, (sr) => sr.stdout.trim().split("\n"));
        });

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

        webview.postCreateWorkflowResponse({
            name: createParams.workflowName,
            path: path.relative(this.workspaceFolder.uri.fsPath, fileUri.result.fsPath),
        });
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
