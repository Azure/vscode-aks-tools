import { ContainerServiceClient } from "@azure/arm-containerservice";
import { ResourceGroup as ARMResourceGroup, Deployment, ResourceManagementClient } from "@azure/arm-resources";
import { Uri, window } from "vscode";
import { getResourceGroupList } from "../commands/utils/clusters";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ProgressEventType, ToVsCodeMsgDef, ToWebViewMsgDef, ResourceGroup as WebviewResourceGroup } from "../webview-contract/webviewDefinitions/createCluster";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ClusterSpec, ClusterSpecBuilder } from "./utilities/ClusterSpecCreationBuilder";
const meta = require('../../package.json');

export class CreateClusterPanel extends BasePanel<"createCluster"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "createCluster", {
            getLocationsResponse: null,
            getResourceGroupsResponse: null,
            progressUpdate: null
        });
    }
}

export class CreateClusterDataProvider implements PanelDataProvider<"createCluster"> {
    public constructor(
        readonly resourceManagementClient: ResourceManagementClient,
        readonly containerServiceClient: ContainerServiceClient,
        readonly portalUrl: string,
        readonly subscriptionId: string,
        readonly subscriptionName: string
    ) { }

    getTitle(): string {
        return `Create Cluster in ${this.subscriptionName}`;
    }

    getInitialState(): InitialState {
        return {
            portalUrl: this.portalUrl,
            portalReferrerContext: meta.name,
            subscriptionId: this.subscriptionId,
            subscriptionName: this.subscriptionName
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: _ => this._handleGetLocationsRequest(webview),
            getResourceGroupsRequest: _ => this._handleGetResourceGroupsRequest(webview),
            createClusterRequest: args => this._handleCreateClusterRequest(args.isNewResourceGroup, args.resourceGroup, args.location, args.name, args.preset, webview)
        };
    }

    private async _handleGetLocationsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const provider = await this.resourceManagementClient.providers.get("Microsoft.ContainerService");
        const resourceTypes = provider.resourceTypes?.filter(t => t.resourceType === "managedClusters");
        if (!resourceTypes || resourceTypes.length > 1) {
            window.showErrorMessage(`Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`);
            return;
        }

        const resourceType = resourceTypes[0];
        if (!resourceType.locations || resourceType.locations.length === 0) {
            window.showErrorMessage("No locations for managedClusters resource type.");
            return;
        }

        webview.postGetLocationsResponse({locations: resourceType.locations});
    }

    private async _handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const groups = await getResourceGroupList(this.resourceManagementClient);
        if (failed(groups)) {
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription: "Retrieving resource groups",
                errorMessage: groups.error
            });
            return;
        }

        const usableGroups = groups.result.filter(isValidResourceGroup).map(g => ({
            label: `${g.name} (${g.location})`,
            name: g.name,
            location: g.location
        })).sort((a, b) => a.name > b.name ? 1 : -1);

        webview.postGetResourceGroupsResponse({groups: usableGroups});
    }

    private async _handleCreateClusterRequest(isNewResourceGroup: boolean, group: WebviewResourceGroup, location: string, name: string, preset:string, webview: MessageSink<ToWebViewMsgDef>) {
        if (isNewResourceGroup) {
            await createResourceGroup(group, webview, this.resourceManagementClient);
        }

        await createCluster(group, location, name, preset, webview, this.containerServiceClient, this.resourceManagementClient);
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
    resourceManagementClient: ResourceManagementClient
) {
    const operationDescription = `Creating resource group ${group.name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null
    });

    try {
        await resourceManagementClient.resourceGroups.createOrUpdate(group.name, group);
    } catch (ex) {
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: getErrorMessage(ex)
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
    resourceManagementClient: ResourceManagementClient
) {
    const operationDescription = `Creating cluster ${name}`;
    webview.postProgressUpdate({
        event: ProgressEventType.InProgress,
        operationDescription,
        errorMessage: null
    });

    const clusterSpec: ClusterSpec = {
        location,
        name,
        resourceGroupName: group.name,
        subscriptionId: "", //TODO
        subscriptionName: "" //TODO
    };

    const deploymentSpec = getManagedClusterSpec(clusterSpec, preset);

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(group.name, name, deploymentSpec);
        //const poller = await containerServiceClient.managedClusters.beginCreateOrUpdate(group.name, name, clusterSpec);
        poller.onProgress(state => {
            if (state.status === "canceled") {
                webview.postProgressUpdate({
                    event: ProgressEventType.Cancelled,
                    operationDescription,
                    errorMessage: null
                });
            } else if (state.status === "failed") {
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
                webview.postProgressUpdate({
                    event: ProgressEventType.Failed,
                    operationDescription,
                    errorMessage
                });
            } else if (state.status === "succeeded") {
                window.showInformationMessage(`Successfully created AKS cluster ${name}.`);
                webview.postProgressUpdate({
                    event: ProgressEventType.Success,
                    operationDescription,
                    errorMessage: null
                });
            }
        });

        // deploymentPoller.onProgress(state => {
        //     if (state.status === "canceled") {
        //         webview.postProgressUpdate({
        //             event: ProgressEventType.Cancelled,
        //             operationDescription,
        //             errorMessage: null
        //         });
        //     } else if (state.status === "failed") {
        //         const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
        //         window.showErrorMessage(`Error creating deployments for AKS cluster ${name}: ${errorMessage}`);
        //         webview.postProgressUpdate({
        //             event: ProgressEventType.Failed,
        //             operationDescription,
        //             errorMessage
        //         });
        //     }
        // });
    
        //await Promise.all([poller.pollUntilDone(), deploymentPoller.pollUntilDone()]);
        await poller.pollUntilDone();
    } catch (ex) {
        const errorMessage = getErrorMessage(ex);
        window.showErrorMessage(`Error creating AKS cluster ${name}: ${errorMessage}`);
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage
        });
    }
}

function getManagedClusterSpec(clusterSpec:ClusterSpec, preset: string): Deployment {
    const specBuilder: ClusterSpecBuilder = new ClusterSpecBuilder();
    //const deploymentSpecBuilder: DeploymentSpecBuilder = new DeploymentSpecBuilder();
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

// function getStandardClusterSpec(location: string, name: string): ManagedCluster {

//     return {
//         addonProfiles: {},
//         location: location,
//         identity: {
//             type: "SystemAssigned"
//         },
//         agentPoolProfiles: [
//             {
//                 name: "nodepool1",
//                 type: "VirtualMachineScaleSets",
//                 count: 2,
//                 enableAutoScaling: true,
//                 minCount: 2,
//                 maxCount: 5,
//                 maxPods: 110,
//                 availabilityZones: ["1", "2", "3"],
//                 enableNodePublicIP: false,
//                 nodeTaints: ["CriticalAddonsOnly=true:NoSchedule"],
//                 mode: "System",
//                 osSKU: "AzureLinux",
//                 osType: "Linux",
//                 vmSize: "Standard_D8ds_v5"
//             },
//             {
//                 name: "userpool",
//                 type: "VirtualMachineScaleSets",
//                 count: 2,
//                 enableAutoScaling: true,
//                 minCount: 2,
//                 maxCount: 100,
//                 maxPods: 110,
//                 availabilityZones: ["1", "2", "3"],
//                 enableNodePublicIP: false,
//                 mode: "User",
//                 osSKU: "AzureLinux",
//                 osType: "Linux",
//                 vmSize: "Standard_D8ds_v5"
//             }
//         ],
//         dnsPrefix: `${name}-dns`
//     };
// }

// // function getDevTestClusterSpec(location: string, name: string): ManagedCluster {
// //     return {
// //         addonProfiles: {},
// //         location: location,
// //         identity: {
// //             type: "SystemAssigned"
// //         },
// //         agentPoolProfiles: [
// //             {
// //                 name: "nodepool1",
// //                 type: "VirtualMachineScaleSets",
// //                 count: 1,
// //                 enableNodePublicIP: true,
// //                 mode: "System",
// //                 osSKU: "AzureLinux",
// //                 osType: "Linux",
// //                 vmSize: "Standard_DS2_v2"
// //             },
// //         ],
// //         dnsPrefix: `${name}-dns`
// //     };
// // }

// function getProductionEconomyClusterSpec(location: string, name: string): ManagedCluster {
//     return {
//         addonProfiles: {},
//         location: location,
//         identity: {
//             type: "SystemAssigned"
//         },
//         agentPoolProfiles: [
//             {
//                 name: "nodepool1",
//                 type: "VirtualMachineScaleSets",
//                 count: 2,
//                 enableNodePublicIP: true,
//                 mode: "System",
//                 osSKU: "AzureLinux",
//                 osType: "Linux",
//                 vmSize: "Standard_D8ds_v5"
//             },
//         ],
//         dnsPrefix: `${name}-dns`
//     };
// }

// function getProductionEnterpriseClusterSpec(location: string, name: string): ManagedCluster {
//     return {
//         addonProfiles: {},
//         location: location,
//         identity: {
//             type: "SystemAssigned"
//         },
//         agentPoolProfiles: [
//             {
//                 name: "nodepool1",
//                 type: "VirtualMachineScaleSets",
//                 count: 2,
//                 enableNodePublicIP: true,
//                 mode: "System",
//                 osSKU: "AzureLinux",
//                 osType: "Linux",
//                 vmSize: "Standard_D16ds_v5"
//             },
//         ],
//         dnsPrefix: `${name}-dns`
//     };
// }