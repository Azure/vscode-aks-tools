import { Uri, window, WorkspaceFolder } from "vscode";
import path from "path";
import * as fs from "fs";
import { BasePanel, PanelDataProvider } from "../BasePanel";
import {
    CreateParams,
    ExistingFiles,
    InitialSelection,
    InitialState,
    LaunchDraftWorkflowParams,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/draft/draftDeployment";
import { TelemetryDefinition } from "../../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../../webview-contract/messaging";
import { exec, ShellOptions } from "../../commands/utils/shell";
import { failed } from "../../commands/utils/errorable";
import { OpenFileOptions } from "../../webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { getClusterNamespaces } from "../../commands/utils/clusters";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { DeploymentFiles } from "../../commands/utils/draft";
import { getSubscriptions, SelectionType } from "../../commands/utils/subscriptions";
import { getAcrRegistry, getRepositories, getRepositoryTags } from "../../commands/utils/acrs";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getResources } from "../../commands/utils/azureResources";
import { launchDraftCommand } from "./commandUtils";
import { AcrKey, ClusterKey } from "../../webview-contract/webviewDefinitions/draft/types";

export class DraftDeploymentPanel extends BasePanel<"draftDeployment"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "draftDeployment", {
            pickLocationResponse: null,
            getSubscriptionsResponse: null,
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
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly workspaceFolder: WorkspaceFolder,
        readonly draftBinaryPath: string,
        readonly kubectl: APIAvailable<KubectlV1>,
        readonly deploymentFiles: DeploymentFiles,
        readonly initialLocation: string,
        readonly initialSelection: InitialSelection,
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
            location: this.initialLocation,
            existingFiles: getExistingFiles(this.workspaceFolder, this.initialLocation, this.deploymentFiles),
            initialSelection: this.initialSelection,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"draftDeployment"> {
        return {
            pickLocationRequest: false,
            getSubscriptionsRequest: false,
            getAcrsRequest: false,
            getRepositoriesRequest: false,
            getRepoTagsRequest: false,
            getClustersRequest: false,
            getNamespacesRequest: false,
            createDeploymentRequest: true,
            openFileRequest: false,
            launchDraftWorkflow: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: (openFileOptions) => this.handlePickLocationRequest(openFileOptions, webview),
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getAcrsRequest: (key) => this.handleGetAcrsRequest(key.subscriptionId, webview),
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
            getClustersRequest: (key) => this.handleGetClustersRequest(key.subscriptionId, webview),
            getNamespacesRequest: (key) =>
                this.handleGetNamespacesRequest(key.subscriptionId, key.resourceGroup, key.clusterName, webview),
            createDeploymentRequest: (args) => this.handleCreateDeploymentRequest(args, webview),
            openFileRequest: (filePath) => this.handleOpenFileRequest(filePath),
            launchDraftWorkflow: (args) => this.handleLaunchDraftWorkflow(args),
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

    private async handleGetRepoTagsRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        repositoryName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const registry = await getAcrRegistry(this.sessionProvider, subscriptionId, resourceGroup, acrName);
        if (failed(registry)) {
            window.showErrorMessage(registry.error);
            return;
        }

        const tags = await getRepositoryTags(this.sessionProvider, registry.result, repositoryName);
        if (failed(tags)) {
            window.showErrorMessage(tags.error);
            return;
        }

        webview.postGetRepoTagsResponse({ subscriptionId, resourceGroup, acrName, repositoryName, tags: tags.result });
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

    private async handleCreateDeploymentRequest(args: CreateParams, webview: MessageSink<ToWebViewMsgDef>) {
        const registry = await getAcrRegistry(
            this.sessionProvider,
            args.subscriptionId,
            args.acrResourceGroup,
            args.acrName,
        );
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
            PORT: args.targetPort,
            SERVICEPORT: args.servicePort,
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

    private handleLaunchDraftWorkflow(params: LaunchDraftWorkflowParams) {
        const dockerfilePath = path.join(params.deploymentLocation, "Dockerfile");
        const dockerfileExists = fs.existsSync(path.join(this.workspaceFolder.uri.fsPath, dockerfilePath));
        const existingFiles = getExistingFiles(this.workspaceFolder, params.deploymentLocation, this.deploymentFiles);
        const helmChartYamlFilePath = existingFiles.helm.find((f) => path.basename(f) === "Chart.yaml");
        const helmChartPath = helmChartYamlFilePath ? path.dirname(helmChartYamlFilePath) : undefined;
        const helmValuesYamlPath = existingFiles.helm.find((f) => path.basename(f) === "values.yaml");
        launchDraftCommand("aks.draftWorkflow", {
            workspaceFolder: this.workspaceFolder,
            initialSelection: {
                subscriptionId: params.initialSubscriptionId || undefined,
                acrResourceGroup: params.initialAcrResourceGroup || undefined,
                acrName: params.initialAcrName || undefined,
                acrRepository: params.initialAcrRepository || undefined,
                clusterResourceGroup: params.initialClusterResourceGroup || undefined,
                clusterName: params.initialClusterName || undefined,
                clusterNamespace: params.initialClusterNamespace || undefined,
                dockerfileBuildContextPath: dockerfileExists ? params.deploymentLocation : undefined,
                dockerfilePath: dockerfileExists ? dockerfilePath : undefined,
                deploymentSpecType:
                    // Only helm and manifests are supported for now
                    params.initialDeploymentSpecType === "manifests" || params.initialDeploymentSpecType === "helm"
                        ? params.initialDeploymentSpecType
                        : undefined,
                helmChartPath,
                helmValuesYamlPath,
                manifestFilePaths: existingFiles.manifests,
            },
        });
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
