import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources, DefinedResourceWithGroup } from "../utils/azureResources";
import { getClusters, Cluster, getClusterNamespaces, getManagedCluster } from "../utils/clusters";
import { extension } from "vscode-kubernetes-tools-api";
import { getAuthorizationManagementClient } from "../utils/arm";
import { getPrincipalRoleAssignmentsForAcr } from "../utils/roleAssignments";
import { acrPullRoleDefinitionName } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { failed } from "../utils/errorable";
import { logger } from "./logger";

export type { Cluster } from "../utils/clusters";

export interface SubscriptionInfo {
    id: string;
    name: string;
}

export interface AzureResource {
    id: string;
    name: string;
    resourceGroup: string;
}

async function fetchSubscriptionAcrs(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<DefinedResourceWithGroup[] | undefined> {
    const acrsResult = await getResources(sessionProvider, subscriptionId, "Microsoft.ContainerRegistry/registries");

    if (!acrsResult.succeeded) {
        vscode.window.showErrorMessage(acrsResult.error);
        return undefined;
    }

    if (acrsResult.result.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(
            l10n.t("No Azure Container Registries found in subscription."),
            openPortal,
        );

        if (selection === openPortal) {
            void vscode.env.openExternal(
                vscode.Uri.parse("https://portal.azure.com/#create/Microsoft.ContainerRegistry"),
            );
        }
        return undefined;
    }

    return acrsResult.result;
}

export async function selectAzureSubscription(
    sessionProvider: ReadyAzureSessionProvider,
): Promise<SubscriptionInfo | undefined> {
    const subscriptionsResult = await getSubscriptions(sessionProvider, SelectionType.All);

    if (!subscriptionsResult.succeeded) {
        vscode.window.showErrorMessage(subscriptionsResult.error);
        return undefined;
    }

    if (subscriptionsResult.result.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(l10n.t("No Azure subscriptions found."), openPortal);

        if (selection === openPortal) {
            void vscode.env.openExternal(
                vscode.Uri.parse("https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade"),
            );
        }
        return undefined;
    }

    const subscriptionItems = subscriptionsResult.result.map((sub) => ({
        label: sub.displayName,
        description: sub.subscriptionId,
        subscription: { id: sub.subscriptionId, name: sub.displayName },
    }));

    const selected = await vscode.window.showQuickPick(subscriptionItems, {
        placeHolder: l10n.t("Select Azure subscription"),
        title: l10n.t("Azure Subscription ({0} available)", subscriptionsResult.result.length),
    });

    return selected?.subscription;
}

export async function selectAksCluster(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Cluster | undefined> {
    const clustersResult = await getClusters(sessionProvider, subscriptionId);

    if (!clustersResult || clustersResult.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(
            l10n.t("No AKS clusters found in subscription."),
            openPortal,
        );

        if (selection === openPortal) {
            void vscode.env.openExternal(vscode.Uri.parse("https://portal.azure.com/#create/microsoft.aks"));
        }
        return undefined;
    }

    const clusterItems = clustersResult
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cluster) => ({
            label: cluster.name,
            description: cluster.resourceGroup,
            cluster,
        }));

    const selected = await vscode.window.showQuickPick(clusterItems, {
        placeHolder: l10n.t("Select AKS cluster for deployment"),
        title: l10n.t("AKS Cluster ({0} available)", clustersResult.length),
    });

    return selected?.cluster;
}

export async function selectClusterNamespace(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<string | undefined> {
    const kubectl = await extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(l10n.t("kubectl is not available. Please install kubectl extension."));
        return undefined;
    }

    const namespacesResult = await getClusterNamespaces(
        sessionProvider,
        kubectl,
        subscriptionId,
        cluster.resourceGroup,
        cluster.name,
    );

    if (!namespacesResult.succeeded) {
        vscode.window.showErrorMessage(
            l10n.t("Failed to retrieve namespaces from cluster: {0}", namespacesResult.error),
        );
        return undefined;
    }

    if (namespacesResult.result.length === 0) {
        vscode.window.showWarningMessage(l10n.t("No namespaces found in cluster."));
        return undefined;
    }

    const namespaceItems = namespacesResult.result.sort().map((ns) => ({
        label: ns,
        description: ns === "default" ? l10n.t("Default namespace") : undefined,
    }));

    const selected = await vscode.window.showQuickPick(namespaceItems, {
        placeHolder: l10n.t("Select Kubernetes namespace"),
        title: l10n.t("Namespace ({0} available)", namespacesResult.result.length),
    });

    return selected?.label;
}

export async function selectClusterAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<AzureResource | undefined> {
    const allAcrs = await fetchSubscriptionAcrs(sessionProvider, subscriptionId);
    if (!allAcrs) return undefined;

    // Attempt to filter ACRs to only those attached to the cluster via AcrPull role
    const attachedAcrs = await getAttachedAcrs(sessionProvider, subscriptionId, cluster, allAcrs);

    // If we found attached ACRs, show only those; otherwise fall back to all ACRs
    const acrsToShow = attachedAcrs.length > 0 ? attachedAcrs : allAcrs;
    const showingAttachedOnly = attachedAcrs.length > 0;

    if (showingAttachedOnly) {
        logger.info(`Showing ${acrsToShow.length} attached ACR(s) for cluster '${cluster.name}'`);
    } else {
        logger.info(`No attached ACRs found — falling back to all ${acrsToShow.length} ACR(s) in subscription`);
    }

    const acrItems = acrsToShow
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((acr) => ({
            label: acr.name,
            description: acr.resourceGroup,
            detail: showingAttachedOnly
                ? l10n.t("Attached to cluster '{0}'", cluster.name)
                : l10n.t("Ensure this ACR is attached to cluster '{0}'", cluster.name),
            acr: {
                id: acr.id,
                name: acr.name,
                resourceGroup: acr.resourceGroup,
            },
        }));

    const title = showingAttachedOnly
        ? l10n.t("Attached Container Registries ({0} found)", acrsToShow.length)
        : l10n.t("Container Registry ({0} available)", acrsToShow.length);

    const selected = await vscode.window.showQuickPick(acrItems, {
        placeHolder: l10n.t("Select Azure Container Registry for cluster '{0}'", cluster.name),
        title,
    });

    return selected?.acr;
}

/**
 * Returns the subset of ACRs that are attached to the given cluster via AcrPull role assignment.
 * Falls back to an empty array if the principal ID cannot be determined or role checks fail.
 */
async function getAttachedAcrs(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
    allAcrs: DefinedResourceWithGroup[],
): Promise<DefinedResourceWithGroup[]> {
    logger.info(`Checking ${allAcrs.length} ACR(s) for AcrPull role attachment to cluster '${cluster.name}'`);

    // Get the cluster's kubelet principal ID
    const principalId = await getClusterPrincipalId(sessionProvider, subscriptionId, cluster);
    if (!principalId) {
        logger.warn("Could not determine cluster principal ID — skipping attached ACR filtering");
        return [];
    }

    const authClient = getAuthorizationManagementClient(sessionProvider, subscriptionId);
    const attachedAcrs: DefinedResourceWithGroup[] = [];

    for (const acr of allAcrs) {
        logger.debug(`Checking role assignments for ACR '${acr.name}' (RG: ${acr.resourceGroup})`);
        const roleAssignments = await getPrincipalRoleAssignmentsForAcr(
            authClient,
            principalId,
            acr.resourceGroup,
            acr.name,
        );

        if (failed(roleAssignments)) {
            logger.warn(`Failed to get role assignments for ACR '${acr.name}': ${roleAssignments.error}`);
            continue;
        }

        logger.debug(
            `ACR '${acr.name}': ${roleAssignments.result.length} role assignment(s) found for principal ${principalId}`,
        );

        const hasAcrPull = roleAssignments.result.some((ra) => {
            if (!ra.roleDefinitionId) return false;
            const roleDefName = ra.roleDefinitionId.split("/").pop();
            return roleDefName === acrPullRoleDefinitionName;
        });

        if (hasAcrPull) {
            logger.info(`ACR '${acr.name}' is attached to cluster '${cluster.name}' (AcrPull role found)`);
            attachedAcrs.push(acr);
        } else {
            logger.debug(`ACR '${acr.name}' is NOT attached to cluster '${cluster.name}' (no AcrPull role)`);
        }
    }

    logger.info(
        `Attached ACR filtering complete: ${attachedAcrs.length} of ${allAcrs.length} ACR(s) attached to cluster '${cluster.name}'`,
    );
    return attachedAcrs;
}

/**
 * Extracts the principal ID (kubelet identity or service principal) from a managed cluster.
 * Returns undefined if the principal ID cannot be determined.
 */
async function getClusterPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<string | undefined> {
    logger.debug(`Fetching managed cluster details for '${cluster.name}' in resource group '${cluster.resourceGroup}'`);
    const managedClusterResult = await getManagedCluster(
        sessionProvider,
        subscriptionId,
        cluster.resourceGroup,
        cluster.name,
    );

    if (failed(managedClusterResult)) {
        logger.warn(`Failed to get managed cluster '${cluster.name}': ${managedClusterResult.error}`);
        return undefined;
    }

    const managedCluster = managedClusterResult.result;
    logger.debug(`Cluster identity type: ${managedCluster.identity?.type ?? "none"}`);

    // Prefer kubelet identity (managed identity clusters)
    const hasManagedIdentity =
        managedCluster.identity?.type === "SystemAssigned" || managedCluster.identity?.type === "UserAssigned";
    if (hasManagedIdentity) {
        if (
            managedCluster.identityProfile &&
            "kubeletidentity" in managedCluster.identityProfile &&
            managedCluster.identityProfile.kubeletidentity.objectId
        ) {
            const principalId = managedCluster.identityProfile.kubeletidentity.objectId;
            logger.info(`Cluster '${cluster.name}' kubelet identity principal ID: ${principalId}`);
            return principalId;
        }
        logger.warn(`Cluster '${cluster.name}' has managed identity but no kubelet identity object ID`);
        return undefined;
    }

    // Fall back to service principal
    const spClientId = managedCluster.servicePrincipalProfile?.clientId;
    if (spClientId) {
        logger.info(`Cluster '${cluster.name}' service principal client ID: ${spClientId}`);
    } else {
        logger.warn(`Cluster '${cluster.name}' has no kubelet identity or service principal`);
    }
    return spClientId ?? undefined;
}

/**
 * Authenticates with Azure and returns a session provider.
 * Single source for getReadySessionProvider() + error handling.
 */
export async function authenticateAzure(): Promise<ReadyAzureSessionProvider | undefined> {
    const sessionProviderResult = await getReadySessionProvider();
    if (failed(sessionProviderResult)) {
        vscode.window.showErrorMessage(
            l10n.t("Azure login required. Please sign in to Azure to select a Container Registry."),
        );
        return undefined;
    }
    return sessionProviderResult.result;
}

/**
 * Prompts user to enter a workflow name with validation.
 * Returns the workflow name, or undefined if cancelled.
 */
export async function promptForWorkflowName(appName: string): Promise<string | undefined> {
    const defaultWorkflowName = `deploy-${appName}-to-aks`;
    const workflowName = await vscode.window.showInputBox({
        prompt: l10n.t("Enter workflow name"),
        placeHolder: defaultWorkflowName,
        value: defaultWorkflowName,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return l10n.t("Workflow name is required");
            }
            if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
                return l10n.t("Workflow name can only contain letters, numbers, hyphens, and underscores");
            }
            return undefined;
        },
    });
    if (!workflowName) {
        logger.info("Workflow name input cancelled");
        return undefined;
    }
    logger.debug("Workflow name selected", workflowName);
    return workflowName;
}

/**
 * Prompts user to select an ACR from the subscription (no cluster required).
 * Returns the AzureResource for the selected ACR.
 */
export async function selectAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<AzureResource | undefined> {
    const allAcrs = await fetchSubscriptionAcrs(sessionProvider, subscriptionId);
    if (!allAcrs) return undefined;

    const acrItems = allAcrs
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((acr) => ({
            label: `${acr.name}.azurecr.io`,
            description: acr.resourceGroup,
            acr: {
                id: acr.id,
                name: acr.name,
                resourceGroup: acr.resourceGroup,
            },
        }));

    const selected = await vscode.window.showQuickPick(acrItems, {
        placeHolder: l10n.t("Select Azure Container Registry"),
        title: l10n.t("Container Registry ({0} available)", allAcrs.length),
    });

    return selected?.acr;
}

export interface AzureContext {
    acrName: string;
    acrResourceGroup: string;
    clusterName?: string;
    clusterResourceGroup?: string;
    namespace?: string;
    workflowName?: string;
}

/**
 * Collects Azure context from the user through a series of prompts.
 * Returns undefined if the user cancels any step.
 */
export async function collectAzureContext(
    hasWorkflow: boolean,
    projectRoot: string,
): Promise<AzureContext | undefined> {
    const sessionProvider = await authenticateAzure();
    if (!sessionProvider) return undefined;

    const subscription = await selectAzureSubscription(sessionProvider);
    if (!subscription) return undefined;
    logger.debug("Subscription selected", subscription.name);

    // Deployment only : need only subscription and ACR
    if (!hasWorkflow) {
        const acr = await selectAcr(sessionProvider, subscription.id);
        if (!acr) return undefined;
        logger.info(`ACR selected: ${acr.name}.azurecr.io`);

        return { acrName: acr.name, acrResourceGroup: acr.resourceGroup };
    }

    // Workflow (with or without deployment): need full cluster context
    const cluster = await selectAksCluster(sessionProvider, subscription.id);
    if (!cluster) return undefined;
    logger.debug("Cluster selected", cluster.name);

    const acr = await selectClusterAcr(sessionProvider, subscription.id, cluster);
    if (!acr) return undefined;
    logger.info(`ACR selected: ${acr.name}.azurecr.io`);

    const namespace = await selectClusterNamespace(sessionProvider, subscription.id, cluster);
    if (!namespace) return undefined;
    logger.debug("Namespace selected", namespace);

    const workflowName = await promptForWorkflowName(path.basename(projectRoot));
    if (!workflowName) return undefined;

    return {
        acrName: acr.name,
        acrResourceGroup: acr.resourceGroup,
        clusterName: cluster.name,
        clusterResourceGroup: cluster.resourceGroup,
        namespace,
        workflowName,
    };
}
