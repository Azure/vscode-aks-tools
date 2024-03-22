import { ContainerServiceClient, KubernetesVersion } from "@azure/arm-containerservice";
import { ResourceGroup as ARMResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import { Uri, window } from "vscode";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    Preset,
    ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
    ResourceGroup as WebviewResourceGroup,
} from "../webview-contract/webviewDefinitions/createCluster";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ClusterDeploymentBuilder, ClusterSpec } from "./utilities/ClusterSpecCreationBuilder";
import { getPortalResourceUrl } from "../commands/utils/env";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { getAksClient, getResourceManagementClient } from "../commands/utils/arm";
import { getAuthSession, getEnvironment } from "../auth/azureAuth";

export class CreateClusterPanel extends BasePanel<"createCluster"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "createCluster", {
            getLocationsResponse: null,
            getResourceGroupsResponse: null,
            progressUpdate: null,
        });
    }
}

export class CreateClusterDataProvider implements PanelDataProvider<"createCluster"> {
    private readonly resourceManagementClient: ResourceManagementClient;
    private readonly containerServiceClient: ContainerServiceClient;

    public constructor(
        readonly subscriptionId: string,
        readonly subscriptionName: string,
        readonly refreshTree: () => void,
    ) {
        this.resourceManagementClient = getResourceManagementClient(this.subscriptionId);
        this.containerServiceClient = getAksClient(this.subscriptionId);
    }

    getTitle(): string {
        return `Create Cluster in ${this.subscriptionName}`;
    }

    getInitialState(): InitialState {
        return {
            subscriptionId: this.subscriptionId,
            subscriptionName: this.subscriptionName,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"createCluster"> {
        return {
            getResourceGroupsRequest: false,
            getLocationsRequest: false,
            createClusterRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => this.handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => this.handleGetResourceGroupsRequest(webview),
            createClusterRequest: (args) =>
                this.handleCreateClusterRequest(
                    args.isNewResourceGroup,
                    args.resourceGroupName,
                    args.location,
                    args.name,
                    args.preset,
                    webview,
                ),
        };
    }

    private async handleGetLocationsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const provider = await this.resourceManagementClient.providers.get("Microsoft.ContainerService");
        const resourceTypes = provider.resourceTypes?.filter((t) => t.resourceType === "managedClusters");
        if (!resourceTypes || resourceTypes.length > 1) {
            window.showErrorMessage(
                `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
            );
            return;
        }

        const resourceType = resourceTypes[0];
        if (!resourceType.locations || resourceType.locations.length === 0) {
            window.showErrorMessage("No locations for managedClusters resource type.");
            return;
        }

        webview.postGetLocationsResponse({ locations: resourceType.locations });
    }

    private async handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const groups = await getResourceGroups(this.subscriptionId);
        if (failed(groups)) {
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription: "Retrieving resource groups",
                errorMessage: groups.error,
                deploymentPortalUrl: null,
                createdCluster: null,
            });
            return;
        }

        const usableGroups = groups.result
            .filter(isValidResourceGroup)
            .map((g) => ({
                label: `${g.name} (${g.location})`,
                name: g.name,
                location: g.location,
            }))
            .sort((a, b) => (a.name > b.name ? 1 : -1));

        webview.postGetResourceGroupsResponse({ groups: usableGroups });
    }

    private async handleCreateClusterRequest(
        isNewResourceGroup: boolean,
        groupName: string,
        location: string,
        name: string,
        preset: Preset,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            const group = {
                name: groupName,
                location,
            };
            await createResourceGroup(group, webview, this.resourceManagementClient);
        }

        await createCluster(
            this.subscriptionId,
            groupName,
            location,
            name,
            preset,
            webview,
            this.containerServiceClient,
            this.resourceManagementClient,
        );

        this.refreshTree();
    }
}

function isValidResourceGroup(group: ARMResourceGroup): group is WebviewResourceGroup {
    if (!group.name || !group.id) return false;
    if (group.name?.startsWith("MC_")) return false;

    return true;
}

async function createResourceGroup(
    group: WebviewResourceGroup,
    webview: MessageSink<ToWebViewMsgDef>,
    resourceManagementClient: ResourceManagementClient,
) {
    const operationDescription = `Creating resource group ${group.name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null,
        deploymentPortalUrl: null,
        createdCluster: null,
    });

    try {
        await resourceManagementClient.resourceGroups.createOrUpdate(group.name, group);
    } catch (ex) {
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: getErrorMessage(ex),
            deploymentPortalUrl: null,
            createdCluster: null,
        });
    }
}

async function createCluster(
    subscriptionId: string,
    groupName: string,
    location: string,
    name: string,
    preset: Preset,
    webview: MessageSink<ToWebViewMsgDef>,
    containerServiceClient: ContainerServiceClient,
    resourceManagementClient: ResourceManagementClient,
) {
    const operationDescription = `Creating cluster ${name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null,
        deploymentPortalUrl: null,
        createdCluster: null,
    });

    // kubernetes version is required to create a cluster via deployments
    const kubernetesVersionsResult = await containerServiceClient.managedClusters.listKubernetesVersions(location);
    const kubernetesVersions = kubernetesVersionsResult.values || [];
    const hasDefaultVersion = kubernetesVersions.some(isDefaultK8sVersion);
    const [kubernetesVersion] = hasDefaultVersion ? kubernetesVersions.filter(isDefaultK8sVersion) : kubernetesVersions;
    if (!kubernetesVersion?.version) {
        window.showErrorMessage(`No Kubernetes versions available for location ${location}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: "No Kubernetes versions available for location",
            deploymentPortalUrl: null,
            createdCluster: null,
        });
        return;
    }

    const session = await getAuthSession();
    if (failed(session)) {
        window.showErrorMessage(`Error getting authentication session: ${session.error}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: session.error,
            deploymentPortalUrl: null,
            createdCluster: null,
        });
        return;
    }

    const clusterSpec: ClusterSpec = {
        location,
        name,
        resourceGroupName: groupName,
        subscriptionId: subscriptionId,
        kubernetesVersion: kubernetesVersion.version,
        username: session.result.account.label, // Account label seems to be email address
    };

    // Create a unique deployment name.
    const deploymentName = `${name}-${Math.random().toString(36).substring(5)}`;
    const deploymentSpec = new ClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec)
        .buildTemplate(preset)
        .getDeployment();

    const environment = getEnvironment();

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(
            groupName,
            deploymentName,
            deploymentSpec,
        );
        const deploymentArmId = `/subscriptions/${subscriptionId}/resourcegroups/${groupName}/providers/Microsoft.Resources/deployments/${deploymentName}`;
        const deploymentPortalUrl = getPortalResourceUrl(environment, deploymentArmId);
        webview.postProgressUpdate({
            event: ProgressEventType.InProgress,
            operationDescription,
            errorMessage: null,
            deploymentPortalUrl,
            createdCluster: null,
        });

        poller.onProgress((state) => {
            if (state.status === "canceled") {
                webview.postProgressUpdate({
                    event: ProgressEventType.Cancelled,
                    operationDescription,
                    errorMessage: null,
                    deploymentPortalUrl,
                    createdCluster: null,
                });
            } else if (state.status === "failed") {
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
                webview.postProgressUpdate({
                    event: ProgressEventType.Failed,
                    operationDescription,
                    errorMessage,
                    deploymentPortalUrl,
                    createdCluster: null,
                });
            } else if (state.status === "succeeded") {
                window.showInformationMessage(`Successfully created AKS cluster ${name}.`);
                const armId = `/subscriptions/${subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.ContainerService/managedClusters/${name}`;
                webview.postProgressUpdate({
                    event: ProgressEventType.Success,
                    operationDescription,
                    errorMessage: null,
                    deploymentPortalUrl,
                    createdCluster: {
                        portalUrl: getPortalResourceUrl(environment, armId),
                    },
                });
            }
        });
        await poller.pollUntilDone();
    } catch (ex) {
        const errorMessage = isInvalidTemplateDeploymentError(ex)
            ? getInvalidTemplateErrorMessage(ex)
            : getErrorMessage(ex);
        window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage,
            deploymentPortalUrl: null,
            createdCluster: null,
        });
    }
}

function getInvalidTemplateErrorMessage(ex: InvalidTemplateDeploymentRestError): string {
    const innerDetails = ex.details.error?.details || [];
    if (innerDetails.length > 0) {
        const details = innerDetails.map((d) => `${d.code}: ${d.message}`).join("\n");
        return `Invalid template:\n${details}`;
    }

    const innerError = ex.details.error?.message || "";
    if (innerError) {
        return `Invalid template:\n${innerError}`;
    }

    return `Invalid template: ${getErrorMessage(ex)}`;
}

type InvalidTemplateDeploymentRestError = RestError & {
    details: {
        error?: {
            code: "InvalidTemplateDeployment";
            message?: string;
            details?: {
                code?: string;
                message?: string;
            }[];
        };
    };
};

function isInvalidTemplateDeploymentError(ex: unknown): ex is InvalidTemplateDeploymentRestError {
    return isRestError(ex) && ex.code === "InvalidTemplateDeployment";
}

function isRestError(ex: unknown): ex is RestError {
    return typeof ex === "object" && ex !== null && ex.constructor.name === "RestError";
}

function isDefaultK8sVersion(version: KubernetesVersion): boolean {
    return "isDefault" in version && version.isDefault === true;
}
