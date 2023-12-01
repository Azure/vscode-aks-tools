import { ContainerServiceClient } from "@azure/arm-containerservice";
import { ResourceGroup as ARMResourceGroup, Deployment, ResourceManagementClient } from "@azure/arm-resources";
import { Uri, window } from "vscode";
import { getResourceGroupList } from "../commands/utils/clusters";
import { failed, getErrorMessage, getInnerErrorMessage } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ProgressEventType, ToVsCodeMsgDef, ToWebViewMsgDef, ResourceGroup as WebviewResourceGroup } from "../webview-contract/webviewDefinitions/createCluster";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ClusterSpec, ClusterSpecBuilder } from "./utilities/ClusterSpecCreationBuilder";
import meta from '../../package.json';

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
    public constructor(
        readonly resourceManagementClient: ResourceManagementClient,
        readonly containerServiceClient: ContainerServiceClient,
        readonly portalUrl: string,
        readonly subscriptionId: string,
        readonly subscriptionName: string,
        readonly username: string,
    ) { }

    getTitle(): string {
        return `Create Cluster in ${this.subscriptionName}`;
    }

    getInitialState(): InitialState {
        return {
            portalUrl: this.portalUrl,
            portalReferrerContext: meta.name,
            subscriptionId: this.subscriptionId,
            subscriptionName: this.subscriptionName,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => this.handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => this.handleGetResourceGroupsRequest(webview),
            createClusterRequest: (args) =>
                this.handleCreateClusterRequest(
                    args.isNewResourceGroup,
                    args.resourceGroup,
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
        const groups = await getResourceGroupList(this.resourceManagementClient);
        if (failed(groups)) {
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription: "Retrieving resource groups",
                errorMessage: groups.error,
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
        group: WebviewResourceGroup,
        location: string,
        name: string,
        preset: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            await createResourceGroup(group, webview, this.resourceManagementClient);
        }

        await createCluster(group, location, name, preset, webview, this.containerServiceClient, this.resourceManagementClient, this.subscriptionId, this.username);
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
    });

    try {
        await resourceManagementClient.resourceGroups.createOrUpdate(group.name, group);
    } catch (ex) {
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: getErrorMessage(ex),
        });
    }
}

async function createCluster(
    group: WebviewResourceGroup,
    location: string,
    name: string,
    preset: string,
    webview: MessageSink<ToWebViewMsgDef>,
    containerServiceClient: ContainerServiceClient,
    resourceManagementClient: ResourceManagementClient,
    subscriptionId: string,
    username: string
) {
    const operationDescription = `Creating cluster ${name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null,
    });

    // kubernetes version is required to create a cluster via deployments
    const kubernetesVersion = await containerServiceClient.managedClusters.listKubernetesVersions(location);
    if (!kubernetesVersion || !kubernetesVersion.values || kubernetesVersion.values.length === 0 || !kubernetesVersion.values[0].version) {
        window.showErrorMessage(`No Kubernetes versions available for location ${location}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: "No Kubernetes versions available for location",
        });
        return;
    }

    const clusterSpec: ClusterSpec = {
        location,
        name,
        resourceGroupName: group.name,
        subscriptionId: subscriptionId,
        kubernetesVersion: kubernetesVersion.values[0].version, // selecting the latest version since versions come in descending order
        username: username
    };

    const deploymentSpec = getManagedClusterSpec(clusterSpec, preset);

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(group.name, name, deploymentSpec);
        poller. onProgress(state => {
            if (state.status === "canceled") {
                webview.postProgressUpdate({
                    event: ProgressEventType.Cancelled,
                    operationDescription,
                    errorMessage: null,
                });
            } else if (state.status === "failed") {
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
                webview.postProgressUpdate({
                    event: ProgressEventType.Failed,
                    operationDescription,
                    errorMessage,
                });
            } else if (state.status === "succeeded") {
                window.showInformationMessage(`Successfully created AKS cluster ${name}.`);
                webview.postProgressUpdate({
                    event: ProgressEventType.Success,
                    operationDescription,
                    errorMessage: null,
                });
            }
        });
        await poller.pollUntilDone();
    } catch (ex) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorMessage = (ex instanceof Error && (ex as any).code === "InvalidTemplateDeployment")
            ? getInnerErrorMessage(ex)
            : getErrorMessage(ex);
        window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage,
        });
    }
}

function getManagedClusterSpec(clusterSpec: ClusterSpec, preset: string): Deployment {
    const specBuilder: ClusterSpecBuilder = new ClusterSpecBuilder();
    switch (preset) {
        case "dev":
            return specBuilder.buildDevTestClusterSpec(clusterSpec);
        case "economy":
            return specBuilder.buildProdEconomyClusterSpec(clusterSpec)
        case "enterprise":
            return specBuilder.buildProdEnterpriseClusterSpec(clusterSpec)
        default:
            return specBuilder.buildProdStandardClusterSpec(clusterSpec)
    }
}
