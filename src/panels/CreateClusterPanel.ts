import { ContainerServiceClient, KubernetesVersion } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { ResourceGroup as ARMResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import { Uri, window } from "vscode";
import { getEnvironment } from "../auth/azureAuth";
import { AzureAuthenticationSession, ReadyAzureSessionProvider } from "../auth/types";
import { getAksClient, getFeatureClient, getResourceManagementClient } from "../commands/utils/arm";
import { getDeploymentPortalUrl, getPortalResourceUrl } from "../commands/utils/env";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import {
    createMultipleFeatureRegistrations,
    MultipleFeatureRegistration,
} from "../commands/utils/featureRegistrations";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    PresetType,
    ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
    ResourceGroup as WebviewResourceGroup,
} from "../webview-contract/webviewDefinitions/createCluster";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ClusterDeploymentBuilder, ClusterSpec } from "./utilities/ClusterSpecCreationBuilder";
import { reporter } from "../commands/utils/reporter";
import { getFilteredClusters } from "../commands/utils/config";
import { addItemToClusterFilter } from "../commands/utils/clusterfilter";
import * as l10n from "@vscode/l10n";

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
    private readonly featureClient: FeatureClient;
    private readonly commandId: string;
    public constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly subscriptionName: string,
        readonly refreshTree: () => void,
        commandId: string,
    ) {
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.containerServiceClient = getAksClient(sessionProvider, this.subscriptionId);
        this.featureClient = getFeatureClient(sessionProvider, this.subscriptionId);
        this.commandId = commandId;
    }

    getTitle(): string {
        return l10n.t(`Create Cluster in {0}`, this.subscriptionName);
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
                l10n.t(
                    "Unexpected number of managedClusters resource types for provider ({0}).",
                    resourceTypes?.length || 0,
                ),
            );
            return;
        }

        const resourceType = resourceTypes[0];
        if (!resourceType.locations || resourceType.locations.length === 0) {
            window.showErrorMessage(l10n.t("No locations for managedClusters resource type."));
            return;
        }

        webview.postGetLocationsResponse({ locations: resourceType.locations });
    }

    private async handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const groups = await getResourceGroups(this.sessionProvider, this.subscriptionId);
        if (failed(groups)) {
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription: l10n.t("Retrieving resource groups"),
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
        preset: PresetType,
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
            this.sessionProvider,
            this.subscriptionId,
            groupName,
            location,
            name,
            preset,
            webview,
            this.containerServiceClient,
            this.resourceManagementClient,
            this.featureClient,
            this.commandId,
        );

        // Get the selected clusters from the configuration
        const filteredClusters = getFilteredClusters();

        if (filteredClusters.length === 0) {
            // if there is no filter set, simply refresh the tree
            this.refreshTree();
        } else {
            // if there is a filter set, add the cluster to the filter
            await addItemToClusterFilter(this.subscriptionName, this.subscriptionId, name, this.sessionProvider);
        }
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
    const operationDescription = l10n.t(`Creating resource group {0}`, group.name);
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
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    groupName: string,
    location: string,
    name: string,
    preset: PresetType,
    webview: MessageSink<ToWebViewMsgDef>,
    containerServiceClient: ContainerServiceClient,
    resourceManagementClient: ResourceManagementClient,
    featureClient: FeatureClient,
    commandId: string,
) {
    const operationDescription = l10n.t(`Creating cluster {0}`, name);
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
        window.showErrorMessage(l10n.t(`No Kubernetes versions available for location {0}`, location));
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: l10n.t("No Kubernetes versions available for location"),
            deploymentPortalUrl: null,
            createdCluster: null,
        });
        return;
    }

    const session = await sessionProvider.getAuthSession();
    if (failed(session)) {
        window.showErrorMessage(l10n.t(`Error getting authentication session: {0}`, session.error));
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage: session.error,
            deploymentPortalUrl: null,
            createdCluster: null,
        });
        return;
    }

    // if automatic preset, we need role assignments for the cluster RBAC admin role which requires service principal id
    let servicePrincipalId = "";
    if (preset === PresetType.Automatic) {
        servicePrincipalId = getServicePrincipalId(session.result);
        if (!servicePrincipalId) {
            window.showErrorMessage(l10n.t("No service principal id available for logged in user."));
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription,
                errorMessage: l10n.t("No service principal id available for logged in user."),
                deploymentPortalUrl: null,
                createdCluster: null,
            });
            return;
        }
    }

    const clusterSpec: ClusterSpec = {
        location,
        name,
        resourceGroupName: groupName,
        subscriptionId: subscriptionId,
        kubernetesVersion: kubernetesVersion.version,
        username: session.result.account.label, // Account label seems to be email address
        servicePrincipalId: servicePrincipalId,
    };

    // Create a unique deployment name.
    const deploymentName = `${name}-${Math.random().toString(36).substring(5)}`;
    const deploymentSpec = new ClusterDeploymentBuilder()
        .buildCommonParameters(clusterSpec, preset)
        .buildTemplate(preset)
        .getDeployment();

    const environment = getEnvironment();

    // feature registration
    try {
        await doFeatureRegistration(preset, featureClient);
    } catch (error) {
        window.showErrorMessage(
            l10n.t("Error Registering preview features for AKS cluster {0}: {1}", name, getErrorMessage(error)),
        );
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription: l10n.t("Error Registering preview features for AKS cluster"),
            errorMessage: getErrorMessage(error),
            deploymentPortalUrl: null,
            createdCluster: null,
        });
        return;
    }

    // event name for telemetry reporter
    const eventName = commandId === "aks.createCluster" ? "command" : "aks.ghcp";

    try {
        const poller = await resourceManagementClient.deployments.beginCreateOrUpdate(
            groupName,
            deploymentName,
            deploymentSpec,
        );
        const deploymentArmId = `/subscriptions/${subscriptionId}/resourcegroups/${groupName}/providers/Microsoft.Resources/deployments/${deploymentName}`;
        const deploymentPortalUrl = getDeploymentPortalUrl(environment, deploymentArmId);
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
                reporter.sendTelemetryEvent(eventName, { command: commandId, clusterCreationSuccess: "false" });
                const errorMessage = state.error ? getErrorMessage(state.error) : "Unknown error";
                window.showErrorMessage(l10n.t(`Error creating AKS cluster {0}: {1}`, name, errorMessage));
                webview.postProgressUpdate({
                    event: ProgressEventType.Failed,
                    operationDescription,
                    errorMessage,
                    deploymentPortalUrl,
                    createdCluster: null,
                });
            } else if (state.status === "succeeded") {
                reporter.sendTelemetryEvent(eventName, { command: commandId, clusterCreationSuccess: "true" });
                window.showInformationMessage(l10n.t(`Successfully created AKS cluster {0}.`, name));
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
        window.showErrorMessage(l10n.t(`Error creating AKS cluster {0}: {1}`, name, errorMessage));
        webview.postProgressUpdate({
            event: ProgressEventType.Failed,
            operationDescription,
            errorMessage,
            deploymentPortalUrl: null,
            createdCluster: null,
        });
    }
}

async function doFeatureRegistration(preset: PresetType, featureClient: FeatureClient) {
    if (preset !== PresetType.Automatic) {
        return;
    }
    //Doc link - https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-automatic-deploy?pivots=azure-cli#register-the-feature-flags
    const features: MultipleFeatureRegistration[] = [
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "EnableAPIServerVnetIntegrationPreview",
        },
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "NRGLockdownPreview",
        },
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "SafeguardsPreview",
        },
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "NodeAutoProvisioningPreview",
        },
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "DisableSSHPreview",
        },
        {
            resourceProviderNamespace: "Microsoft.ContainerService",
            featureName: "AutomaticSKUPreview",
        },
    ];

    await createMultipleFeatureRegistrations(featureClient, features);
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
function getServicePrincipalId(result: AzureAuthenticationSession): string {
    // we need servicePrincipalId of the logged in user which is after slash
    if (!result?.account?.id) {
        return "";
    }
    // account id is in the format of tenantID/servicePrincipalId
    // sometimes in case of non aad auth it is in the format of servicePrincipalId.tenantID
    const accountId = result.account.id;
    if (accountId.includes("/")) {
        return accountId.split("/")[1];
    } else if (accountId.includes(".")) {
        return accountId.split(".")[0];
    } else {
        return "";
    }
}
