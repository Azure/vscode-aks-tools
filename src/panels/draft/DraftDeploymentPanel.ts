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
import { failed, map as errmap } from "../../commands/utils/errorable";
import { OpenFileOptions } from "../../webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { ClusterContext, getKubeconfigYaml } from "../../commands/utils/clusters";
import { withOptionalTempFile } from "../../commands/utils/tempfile";
import { APIAvailable, KubectlV1 } from "vscode-kubernetes-tools-api";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { DeploymentFiles } from "../../commands/utils/draft";
import {
    AzureAccountExtensionApi,
    getAcrClient,
    getAcrMgtClient,
    getAcrRegistry,
    getAksClient,
    getAzureSubscription,
    getAzureSubscriptions,
    getResourceManagementClient,
    listAll,
} from "../../commands/utils/azureAccount";

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
        readonly azAccount: AzureAccountExtensionApi,
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

    private async handleGetRepoTagsRequest(
        subscriptionId: string,
        resourceGroup: string,
        acrName: string,
        repositoryName: string,
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
        const repository = await acrClient.result.getRepository(repositoryName);
        const propsResult = await listAll(repository.listManifestProperties());
        const tags = propsResult.flatMap((props) => props.tags);
        webview.postGetRepoTagsResponse({ subscriptionId, resourceGroup, acrName, repositoryName, tags });
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

    private async handleCreateDeploymentRequest(args: CreateParams, webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscription = await getAzureSubscription(this.azAccount, args.subscriptionId);
        if (failed(azureSubscription)) {
            window.showErrorMessage(azureSubscription.error);
            return;
        }
        const registry = await getAcrRegistry(azureSubscription.result, args.acrResourceGroup, args.acrName);
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
