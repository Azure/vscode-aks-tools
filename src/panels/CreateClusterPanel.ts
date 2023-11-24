import { Uri, window } from "vscode";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { ResourceGroup as ARMResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { getResourceGroupList } from "../commands/utils/clusters";
import {
    InitialState,
    ProgressEventType,
    ResourceGroup as WebviewResourceGroup,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/createCluster";
import meta from "../../package.json";

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
    ) {}

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
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            await createResourceGroup(group, webview, this.resourceManagementClient);
        }

        await createCluster(group, location, name, webview, this.containerServiceClient);
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
    webview: MessageSink<ToWebViewMsgDef>,
    containerServiceClient: ContainerServiceClient,
) {
    const operationDescription = `Creating cluster ${name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null,
    });

    const clusterSpec = getManagedClusterSpec(location, name);

    try {
        const poller = await containerServiceClient.managedClusters.beginCreateOrUpdate(group.name, name, clusterSpec);
        poller.onProgress((state) => {
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
        const errorMessage = getErrorMessage(ex);
        window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage,
        });
    }
}

function getManagedClusterSpec(location: string, name: string): ManagedCluster {
    return {
        addonProfiles: {},
        location: location,
        identity: {
            type: "SystemAssigned",
        },
        agentPoolProfiles: [
            {
                name: "nodepool1",
                type: "VirtualMachineScaleSets",
                count: 3,
                enableNodePublicIP: true,
                mode: "System",
                osSKU: "AzureLinux",
                osType: "Linux",
                vmSize: "Standard_DS2_v2",
            },
        ],
        dnsPrefix: `${name}-dns`,
    };
}
