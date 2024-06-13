import { Uri, window } from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { ReadyAzureSessionProvider } from "../auth/types";
import {
    AcrKey,
    ClusterKey,
    InitialSelection,
    InitialState,
    Subscription,
    SubscriptionKey,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
    acrPullRoleDefinitionName,
} from "../webview-contract/webviewDefinitions/connectAcrToCluster";
import { Errorable, failed, getErrorMessage } from "../commands/utils/errorable";
import { SelectionType, getSubscriptions } from "../commands/utils/subscriptions";
import { acrResourceType, clusterResourceType, getResources } from "../commands/utils/azureResources";
import { getAuthorizationManagementClient } from "../commands/utils/arm";
import { RoleAssignment } from "@azure/arm-authorization";
import {
    createRoleAssignment,
    deleteRoleAssignment,
    getPrincipalRoleAssignmentsForAcr,
    getScopeForAcr,
} from "../commands/utils/roleAssignments";
import { getManagedCluster } from "../commands/utils/clusters";

export class ConnectAcrToClusterPanel extends BasePanel<"connectAcrToCluster"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "connectAcrToCluster", {
            // Reference data responses
            getSubscriptionsResponse: null,
            getAcrsResponse: null,
            getClustersResponse: null,

            // Azure resource role assignment responses
            getAcrRoleAssignmentResponse: null,
            createAcrRoleAssignmentResponse: null,
            deleteAcrRoleAssignmentResponse: null,
        });
    }
}

export class ConnectAcrToClusterDataProvider implements PanelDataProvider<"connectAcrToCluster"> {
    constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly initialSelection: InitialSelection,
    ) {}

    getTitle(): string {
        return "Connect ACR to Cluster";
    }

    getInitialState(): InitialState {
        return {
            initialSelection: this.initialSelection,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"connectAcrToCluster"> {
        return {
            // Reference data requests
            getSubscriptionsRequest: false,
            getAcrsRequest: false,
            getClustersRequest: false,

            // Azure resource role assignment requests
            getAcrRoleAssignmentRequest: false,
            createAcrRoleAssignmentRequest: true,
            deleteAcrRoleAssignmentRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            // Reference data requests
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getAcrsRequest: (args) => this.handleGetAcrsRequest(args, webview),
            getClustersRequest: (args) => this.handleGetClustersRequest(args, webview),

            // Azure resource role assignment requests
            getAcrRoleAssignmentRequest: (args) =>
                this.handleGetAcrRoleAssignmentRequest(args.acrKey, args.clusterKey, webview),
            createAcrRoleAssignmentRequest: (args) =>
                this.handleCreateAcrRoleAssignmentRequest(args.acrKey, args.clusterKey, webview),
            deleteAcrRoleAssignmentRequest: (args) =>
                this.handleDeleteAcrRoleAssignmentRequest(args.acrKey, args.clusterKey, webview),
        };
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptionsResult = await getSubscriptions(this.sessionProvider, SelectionType.AllIfNoFilters);
        const azureSubscriptions = defaultAndNotify(azureSubscriptionsResult, []);

        const subscriptions: Subscription[] = azureSubscriptions.map((subscription) => ({
            subscriptionId: subscription.subscriptionId,
            name: subscription.displayName,
        }));

        webview.postGetSubscriptionsResponse({ subscriptions });
    }

    private async handleGetAcrsRequest(key: SubscriptionKey, webview: MessageSink<ToWebViewMsgDef>) {
        const sourceAcrsResult = await getResources(this.sessionProvider, key.subscriptionId, acrResourceType);
        const sourceAcrs = defaultAndNotify(sourceAcrsResult, []);

        const acrs: AcrKey[] = sourceAcrs
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((acr) => ({
                subscriptionId: key.subscriptionId,
                resourceGroup: acr.resourceGroup,
                acrName: acr.name,
            }));

        webview.postGetAcrsResponse({ key, acrs });
    }

    private async handleGetClustersRequest(key: SubscriptionKey, webview: MessageSink<ToWebViewMsgDef>) {
        const sourceClustersResult = await getResources(this.sessionProvider, key.subscriptionId, clusterResourceType);
        const sourceClusters = defaultAndNotify(sourceClustersResult, []);

        const clusters: ClusterKey[] = sourceClusters
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((acr) => ({
                subscriptionId: key.subscriptionId,
                resourceGroup: acr.resourceGroup,
                clusterName: acr.name,
            }));

        webview.postGetClustersResponse({ key, clusters });
    }

    private async handleGetAcrRoleAssignmentRequest(
        acrKey: AcrKey,
        clusterKey: ClusterKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const principalId = await getClusterPrincipalId(this.sessionProvider, clusterKey);
        if (failed(principalId)) {
            window.showErrorMessage(getErrorMessage(principalId));
            return;
        }

        const client = getAuthorizationManagementClient(this.sessionProvider, acrKey.subscriptionId);
        const roleAssignmentsResult = await getPrincipalRoleAssignmentsForAcr(
            client,
            principalId.result,
            acrKey.resourceGroup,
            acrKey.acrName,
        );

        const roleAssignments = defaultAndNotify(roleAssignmentsResult, []);
        const hasAcrPull = roleAssignments.some(isAcrPull);
        webview.postGetAcrRoleAssignmentResponse({
            acrKey,
            clusterKey,
            hasAcrPull,
        });
    }

    private async handleCreateAcrRoleAssignmentRequest(
        acrKey: AcrKey,
        clusterKey: ClusterKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const principalId = await getClusterPrincipalId(this.sessionProvider, clusterKey);
        if (failed(principalId)) {
            window.showErrorMessage(getErrorMessage(principalId));
            return;
        }

        const client = getAuthorizationManagementClient(this.sessionProvider, acrKey.subscriptionId);
        const scope = getScopeForAcr(acrKey.subscriptionId, acrKey.resourceGroup, acrKey.acrName);

        const roleAssignment = await createRoleAssignment(
            client,
            acrKey.subscriptionId,
            principalId.result,
            acrPullRoleDefinitionName,
            "ServicePrincipal",
            scope,
        );

        if (failed(roleAssignment)) {
            window.showErrorMessage(roleAssignment.error);
        }

        const roleAssignmentsResult = await getPrincipalRoleAssignmentsForAcr(
            client,
            principalId.result,
            acrKey.resourceGroup,
            acrKey.acrName,
        );

        const roleAssignments = defaultAndNotify(roleAssignmentsResult, []);
        const hasAcrPull = roleAssignments.some(isAcrPull);
        webview.postCreateAcrRoleAssignmentResponse({
            acrKey,
            clusterKey,
            hasAcrPull,
        });
    }

    private async handleDeleteAcrRoleAssignmentRequest(
        acrKey: AcrKey,
        clusterKey: ClusterKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const principalId = await getClusterPrincipalId(this.sessionProvider, clusterKey);
        if (failed(principalId)) {
            window.showErrorMessage(getErrorMessage(principalId));
            return;
        }

        const client = getAuthorizationManagementClient(this.sessionProvider, acrKey.subscriptionId);
        const scope = getScopeForAcr(acrKey.subscriptionId, acrKey.resourceGroup, acrKey.acrName);
        const deleteResult = await deleteRoleAssignment(
            client,
            acrKey.subscriptionId,
            principalId.result,
            acrPullRoleDefinitionName,
            scope,
        );
        if (failed(deleteResult)) {
            window.showErrorMessage(deleteResult.error);
        }

        const roleAssignmentsResult = await getPrincipalRoleAssignmentsForAcr(
            client,
            principalId.result,
            acrKey.resourceGroup,
            acrKey.acrName,
        );

        const roleAssignments = defaultAndNotify(roleAssignmentsResult, []);
        const hasAcrPull = roleAssignments.some(isAcrPull);
        webview.postDeleteAcrRoleAssignmentResponse({
            acrKey,
            clusterKey,
            hasAcrPull,
        });
    }
}

function isAcrPull(roleAssignment: RoleAssignment): boolean {
    if (!roleAssignment.roleDefinitionId) {
        return false;
    }

    const roleDefinitionName = roleAssignment.roleDefinitionId.split("/").pop();
    return roleDefinitionName === acrPullRoleDefinitionName;
}

async function getClusterPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
): Promise<Errorable<string>> {
    // This is adapted from the Azure CLI implementation of `az aks update --attach-acr`.
    const cluster = await getManagedCluster(
        sessionProvider,
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );
    if (failed(cluster)) {
        return cluster;
    }

    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/_helpers.py#L79-L88
    const hasManagedIdentity =
        cluster.result.identity?.type === "SystemAssigned" || cluster.result.identity?.type === "UserAssigned";
    if (hasManagedIdentity) {
        // For the case where the cluster _has_ a managed identity, use `objectId` from the `kubeletidentity` profile.
        // see: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L6808-L6815
        if (
            cluster.result.identityProfile &&
            "kubeletidentity" in cluster.result.identityProfile &&
            cluster.result.identityProfile.kubeletidentity.objectId
        ) {
            return {
                succeeded: true,
                result: cluster.result.identityProfile.kubeletidentity.objectId,
            };
        }

        return {
            succeeded: false,
            error: "Cluster has managed identity but no kubelet identity",
        };
    }

    // Fall back to the `clientId` property of the service principal profile
    // for the case where the cluster has no managed identity:
    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L5787-L5795
    const servicePrincipalId = cluster.result.servicePrincipalProfile?.clientId;
    if (servicePrincipalId) {
        return {
            succeeded: true,
            result: servicePrincipalId,
        };
    }

    return {
        succeeded: false,
        error: "Cluster has no managed identity or service principal",
    };
}

function defaultAndNotify<T>(value: Errorable<T>, defaultValue: T): T {
    if (failed(value)) {
        window.showErrorMessage(value.error);
        return defaultValue;
    }
    return value.result;
}
