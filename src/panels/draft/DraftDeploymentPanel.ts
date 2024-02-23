import { Uri, window, WorkspaceFolder } from "vscode";
import path from "path";
import * as fs from "fs";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    CreateParams,
    ExistingFiles,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftDeployment";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { exec, ShellOptions } from "../../commands/utils/shell";
import { failed } from "../../commands/utils/errorable";
import { OpenFileOptions } from "../../webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { getClusterNamespaces, getClustersByResourceGroup } from "../../commands/utils/clusters";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { DeploymentFiles } from "../../commands/utils/draft";
import { getSubscriptions, SelectionType } from "../../commands/utils/subscriptions";
import { getResourceGroups } from "../../commands/utils/resourceGroups";
import { getAcrRegistry, getAcrs, getRepositories, getRepositoryTags } from "../../commands/utils/acrs";

export class DraftDeploymentPanel extends BasePanel<"draftDeployment"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftDeployment", {
            pickLocationResponse: null,
            getSubscriptionsResponse: null,
            getResourceGroupsResponse: null,
            getAcrsResponse: null,
            getRepositoriesResponse: null,
            getRepoTagsResponse: null,
            getClustersResponse: null,
            getNamespacesResponse: null,
            createDeploymentResponse: null,
        });
    }
}

export class DraftDeploymentDataProvider implements PanelDataProvider<"draftDeployment"> {
    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly kubectl: APIAvailable<KubectlV1>,
        readonly deploymentFiles: DeploymentFiles,
    ) {}

    getTitle(): string {
        return `Draft Deployment in ${this.workspaceFolder.name}`;
    }

    getInitialState(): InitialState {
        return {
            workspaceConfig: {
                name: this.workspaceFolder.name,
                fullPath: this.workspaceFolder.uri.fsPath,
                pathSeparator: path.sep,
            },
            location: "",
            existingFiles: getExistingFiles(this.workspaceFolder, "", this.deploymentFiles),
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftDeployment"> {
        return {
            pickLocationRequest: false,
            getSubscriptionsRequest: false,
            getResourceGroupsRequest: false,
            getAcrsRequest: false,
            getRepositoriesRequest: false,
            getRepoTagsRequest: false,
            getClustersRequest: false,
            getNamespacesRequest: false,
            createDeploymentRequest: true,
            openFileRequest: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: (openFileOptions) => this.handlePickLocationRequest(openFileOptions, webview),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getResourceGroupsRequest: (key) => this.handleGetResourceGroupsRequest(key.subscriptionId, webview),
            getAcrsRequest: (key) => this.handleGetAcrsRequest(key.subscriptionId, key.resourceGroup, webview),
            getRepositoriesRequest: (key) =>
                this.handleGetRepositoriesRequest(key.subscriptionId, key.resourceGroup, key.acrName, webview),
            getRepoTagsRequest: (key) =>
                this.handleGetRepoTagsRequest(
                    key.subscriptionId,
                    key.resourceGroup,
                    key.acrName,
                    key.repositoryName,
                    webview,
                ),
            getClustersRequest: (key) => this.handleGetClustersRequest(key.subscriptionId, key.resourceGroup, webview),
            getNamespacesRequest: (key) =>
                this.handleGetNamespacesRequest(key.subscriptionId, key.resourceGroup, key.clusterName, webview),
            createDeploymentRequest: (args) => this.handleCreateDeploymentRequest(args, webview),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
        };
    }

    private async handlePickLocationRequest(openFileOptions: OpenFileOptions, webview: MessageSink<ToWebViewMsgDef>) {
        const result = await window.showOpenDialog({
            canSelectFiles: openFileOptions.type === "file",
            canSelectFolders: openFileOptions.type === "directory",
            canSelectMany: false,
            defaultUri: openFileOptions.defaultPath ? Uri.file(openFileOptions.defaultPath) : undefined,
        });

        if (!result || result.length === 0) return;

        const resultDirectory = result[0].fsPath;
        const location = path.relative(this.workspaceFolder.uri.fsPath, resultDirectory);
        const existingFiles = getExistingFiles(this.workspaceFolder, location, this.deploymentFiles);
        webview.postPickLocationResponse({
            location,
            existingFiles,
        });
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptions = await getSubscriptions(SelectionType.AllIfNoFilters);
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

    private async handleGetResourceGroupsRequest(subscriptionId: string, webview: MessageSink<ToWebViewMsgDef>) {
        const resourceGroups = await getResourceGroups(subscriptionId);
        if (failed(resourceGroups)) {
            window.showErrorMessage(resourceGroups.error);
            return;
        }

        const groups = resourceGroups.result.map((resourceGroup) => resourceGroup.name).sort();
        webview.postGetResourceGroupsResponse({ subscriptionId, groups });
    }

    private async handleGetAcrsRequest(
        subscriptionId: string,
        resourceGroup: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const acrs = await getAcrs(subscriptionId, resourceGroup);
        if (failed(acrs)) {
            window.showErrorMessage(acrs.error);
            return;
        }

        const acrNames = acrs.result.map((acr) => acr.name).sort();
        webview.postGetAcrsResponse({ subscriptionId, resourceGroup, acrNames });
    }

    private async handleGetRepositoriesRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const registry = await getAcrRegistry(subscriptionId, resourceGroup, acrName);
        if (failed(registry)) {
            window.showErrorMessage(registry.error);
            return;
        }

        const repositoryNames = await getRepositories(registry.result);
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

    private async handleGetRepoTagsRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        repositoryName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const registry = await getAcrRegistry(subscriptionId, resourceGroup, acrName);
        if (failed(registry)) {
            window.showErrorMessage(registry.error);
            return;
        }

        const tags = await getRepositoryTags(registry.result, repositoryName);
        if (failed(tags)) {
            window.showErrorMessage(tags.error);
            return;
        }

        webview.postGetRepoTagsResponse({ subscriptionId, resourceGroup, acrName, repositoryName, tags: tags.result });
    }

    private async handleGetClustersRequest(
        subscriptionId: string,
        resourceGroup: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const clusters = await getClustersByResourceGroup(subscriptionId, resourceGroup);
        if (failed(clusters)) {
            window.showErrorMessage(clusters.error);
            return;
        }

        const clusterNames = clusters.result.map((cluster) => cluster.name);
        webview.postGetClustersResponse({ subscriptionId, resourceGroup, clusterNames });
    }

    private async handleGetNamespacesRequest(
        subscriptionId: string,
        resourceGroup: string,
        clusterName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const namespacesResult = await getClusterNamespaces(this.kubectl, subscriptionId, resourceGroup, clusterName);
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

    private async handleCreateDeploymentRequest(args: CreateParams, webview: MessageSink<ToWebViewMsgDef>) {
        const registry = await getAcrRegistry(args.subscriptionId, args.acrResourceGroup, args.acrName);
        if (failed(registry)) {
            window.showErrorMessage(registry.error);
            return;
        }
        const imageName = `${registry.result.loginServer}/${args.repositoryName}`;

        const variables = {
            APPNAME: args.applicationName,
            IMAGENAME: imageName,
            IMAGETAG: args.tag,
            NAMESPACE: args.namespace,
            PORT: args.port,
            SERVICEPORT: args.port, // TODO: Separate argument for service port?
        };

        const variableArgs = Object.entries(variables)
            .map(([key, value]) => `--variable ${key}=${value}`)
            .join(" ");

        const language = "java"; // So it doesn't attempt to autodetect the language
        const command = `draft create --language ${language} --deployment-only --deploy-type ${args.deploymentSpecType} --app ${args.applicationName} ${variableArgs} --destination .${path.sep}${args.location}`;

        const execOptions: ShellOptions = {
            workingDir: this.workspaceFolder.uri.fsPath,
            envPaths: [path.dirname(this.draftBinaryPath)],
        };

        const shellResult = await exec(command, execOptions);
        if (failed(shellResult)) {
            window.showErrorMessage(shellResult.error);
            return;
        }

        const existingFiles = getExistingFiles(this.workspaceFolder, args.location, this.deploymentFiles);
        webview.postCreateDeploymentResponse(existingFiles);
    }

    private handleOpenFileRequest(relativeFilePath: string) {
        const filePath = path.join(this.workspaceFolder.uri.fsPath, relativeFilePath);
        window.showTextDocument(Uri.file(filePath));
    }
}

function getExistingFiles(
    workspaceFolder: WorkspaceFolder,
    location: string,
    deploymentFiles: DeploymentFiles,
): ExistingFiles {
    return {
        helm: getExistingFiles(workspaceFolder, location, deploymentFiles.helm),
        kustomize: getExistingFiles(workspaceFolder, location, deploymentFiles.kustomize),
        manifests: getExistingFiles(workspaceFolder, location, deploymentFiles.manifests),
    };

    function getExistingFiles(workspaceFolder: WorkspaceFolder, location: string, filePaths: string[]): string[] {
        return filePaths
            .map((p) => path.join(workspaceFolder.uri.fsPath, location, p))
            .filter((p) => fs.existsSync(p))
            .map((p) => path.relative(workspaceFolder.uri.fsPath, p));
    }
}
