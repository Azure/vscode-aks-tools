import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources, DefinedResourceWithGroup } from "../utils/azureResources";
import {
    getClusters,
    Cluster,
    getManagedCluster,
    getClusterNamespacesWithTypes,
    listManagedNamespacesByCluster,
    validateNamespaceName,
} from "../utils/clusters";
import { extension } from "vscode-kubernetes-tools-api";
import { getAuthorizationManagementClient } from "../utils/arm";
import {
    getPrincipalRoleAssignmentsForAcr,
    createRoleAssignment,
    getScopeForAcr,
    PRINCIPAL_TYPE_SERVICE_PRINCIPAL,
} from "../utils/roleAssignments";
import { acrPullRoleDefinitionName } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { failed } from "../utils/errorable";
import { logger } from "./logger";
import { longRunning } from "../utils/host";
import { getPortalCreateUrl } from "../utils/env";
import { getEnvironment } from "../../auth/azureAuth";
import { showWizardExitConfirmation } from "./wizardUtils";
import { NamespaceData, NamespaceSelection } from "./types";

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
                vscode.Uri.parse(getPortalCreateUrl(getEnvironment(), "create/Microsoft.ContainerRegistry")),
            );
        }
        return undefined;
    }

    return acrsResult.result;
}

export async function selectAzureSubscription(
    sessionProvider: ReadyAzureSessionProvider,
): Promise<SubscriptionInfo | undefined> {
    const subscriptionsResult = await longRunning(l10n.t("Loading Azure subscriptions..."), () =>
        getSubscriptions(sessionProvider, SelectionType.All),
    );

    if (!subscriptionsResult.succeeded) {
        vscode.window.showErrorMessage(subscriptionsResult.error);
        return undefined;
    }

    if (subscriptionsResult.result.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(l10n.t("No Azure subscriptions found."), openPortal);

        if (selection === openPortal) {
            void vscode.env.openExternal(
                vscode.Uri.parse(
                    getPortalCreateUrl(getEnvironment(), "view/Microsoft_Azure_Billing/SubscriptionsBlade"),
                ),
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

    // Show confirmation dialog if user cancelled
    if (!selected) {
        return showWizardExitConfirmation(() => selectAzureSubscription(sessionProvider));
    }

    return selected.subscription;
}

export async function selectAksCluster(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Cluster | undefined> {
    const clustersResult = await longRunning(l10n.t("Loading AKS clusters..."), () =>
        getClusters(sessionProvider, subscriptionId),
    );

    if (!clustersResult || clustersResult.length === 0) {
        const openPortal = l10n.t("Open in Portal");
        const selection = await vscode.window.showWarningMessage(
            l10n.t("No AKS clusters found in subscription."),
            openPortal,
        );

        if (selection === openPortal) {
            void vscode.env.openExternal(
                vscode.Uri.parse(getPortalCreateUrl(getEnvironment(), "create/microsoft.aks")),
            );
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

    // Show confirmation dialog if user cancelled
    if (!selected) {
        return showWizardExitConfirmation(() => selectAksCluster(sessionProvider, subscriptionId));
    }

    return selected.cluster;
}

export async function fetchClusterNamespaces(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<NamespaceData | undefined> {
    const kubectl = await extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(l10n.t("kubectl is not available. Please install kubectl extension."));
        return undefined;
    }

    const namespacesResult = await longRunning(l10n.t("Loading cluster namespaces..."), () =>
        getClusterNamespacesWithTypes(sessionProvider, kubectl, subscriptionId, cluster.resourceGroup, cluster.name),
    );
    logger.debug(`Namespaces with types for cluster '${cluster.name}':`, namespacesResult);

    if (!namespacesResult.succeeded && !isNamespacesListForbidden(namespacesResult.error)) {
        vscode.window.showErrorMessage(
            l10n.t("Failed to retrieve namespaces from cluster: {0}", namespacesResult.error),
        );
        return undefined;
    }

    if (!namespacesResult.succeeded) {
        logger.debug(
            `Namespace list forbidden for cluster '${cluster.name}'. Falling back to ARM-managed namespaces only.`,
        );
        return fetchManagedNamespacesWithWarning(sessionProvider, subscriptionId, cluster);
    }

    const kubectlNamespaces = namespacesResult.result
        .filter((ns) => ns.type !== "system" || ns.name === "default")
        .map((ns) => ({ name: ns.name, isManaged: ns.type === "managed", labels: ns.labels }));

    return { kubectlNamespaces, managedNames: [], accessRestricted: false };
}

async function fetchManagedNamespacesWithWarning(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<NamespaceData> {
    const armResult = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: l10n.t("Loading managed namespaces...") },
        () => listManagedNamespacesByCluster(sessionProvider, subscriptionId, cluster.resourceGroup, cluster.name),
    );

    if (!armResult.succeeded) {
        logger.warn(`Failed to load managed namespaces for cluster '${cluster.name}': ${armResult.error}`);
    }
    const managedNames = armResult.succeeded ? armResult.result : [];
    logger.debug(`Managed namespaces for cluster '${cluster.name}':`, managedNames);

    const learnMoreLabel = l10n.t("Learn more");
    void vscode.window
        .showWarningMessage(
            l10n.t(
                "You don't have permission to list all namespaces on cluster '{0}'. " +
                    "Only ARM-managed namespaces are shown if available. To see all namespaces, " +
                    "ask your admin to assign you the 'Azure Kubernetes Service RBAC Reader' role at the cluster scope.",
                cluster.name,
            ),
            learnMoreLabel,
        )
        .then((selection) => {
            if (selection === learnMoreLabel) {
                void vscode.env.openExternal(
                    vscode.Uri.parse("https://learn.microsoft.com/azure/aks/manage-azure-rbac"),
                );
            }
        });

    return { kubectlNamespaces: undefined, managedNames, accessRestricted: true };
}

export async function selectClusterNamespace(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
    namespaceData?: NamespaceData,
): Promise<NamespaceSelection | undefined> {
    const data = namespaceData ?? (await fetchClusterNamespaces(sessionProvider, subscriptionId, cluster));
    if (!data) return undefined;

    const { kubectlNamespaces, managedNames, accessRestricted } = data;

    const namespaceSource =
        kubectlNamespaces ?? managedNames.map((name) => ({ name, isManaged: true, labels: undefined }));
    const namespaceItems = namespaceSource
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((ns) => ({
            label: ns.name,
            description:
                ns.labels?.["headlamp.dev/project-managed-by"] === "aks-desktop"
                    ? l10n.t("(AKS desktop Project: {0})", ns.name)
                    : undefined,
            isManaged: ns.isManaged,
        }));

    const manualEntryLabel = l10n.t("Enter namespace name ...");
    if (accessRestricted) {
        namespaceItems.push({
            label: manualEntryLabel,
            description: l10n.t("Type the name of an existing namespace"),
            isManaged: false,
        });
    }

    const title = accessRestricted
        ? l10n.t("Namespace — showing managed namespaces only ({0} available)", managedNames.length)
        : l10n.t("Namespace ({0} available)", namespaceSource.length);

    const selected = await vscode.window.showQuickPick(namespaceItems, {
        placeHolder: l10n.t("Select a Kubernetes namespace"),
        title,
        ignoreFocusOut: true,
    });

    if (!selected) {
        return showWizardExitConfirmation(() => selectClusterNamespace(sessionProvider, subscriptionId, cluster, data));
    }

    if (selected.label !== manualEntryLabel) {
        return { name: selected.label, isManaged: selected.isManaged };
    }

    const namespace = await vscode.window.showInputBox({
        prompt: l10n.t(
            "You do not have permission to list namespaces in this cluster. " +
                "Ask your admin to assign the 'Azure Kubernetes Service RBAC Reader' role " +
                "at the cluster scope to list all namespaces automatically.",
        ),
        placeHolder: "my-namespace",
        title: l10n.t("Namespace"),
        ignoreFocusOut: true,
        validateInput: (value) => {
            const v = value?.trim() || "";
            if (!v) return l10n.t("Namespace name is required");
            if (!validateNamespaceName(v)) {
                return l10n.t(
                    "Invalid namespace name. Names must be RFC 1123 compliant: lowercase alphanumeric characters or '-', start and end with an alphanumeric character, max 63 characters. See: https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#dns-label-names",
                );
            }
            return undefined;
        },
    });

    if (!namespace) {
        return showWizardExitConfirmation(() => selectClusterNamespace(sessionProvider, subscriptionId, cluster, data));
    }

    const trimmed = namespace.trim();
    // Check whether the typed name matches a known ARM-managed namespace.
    const isManaged = namespaceSource.some((ns) => ns.name === trimmed && ns.isManaged);
    return { name: trimmed, isManaged };
}

function isNamespacesListForbidden(error: string): boolean {
    return /Error from server \(Forbidden\)|cannot list resource "namespaces"|cannot list resource 'namespaces'/i.test(
        error,
    );
}

export async function selectClusterAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<AzureResource | undefined> {
    const allAcrs = await longRunning(l10n.t("Loading Azure Container Registries..."), () =>
        fetchSubscriptionAcrs(sessionProvider, subscriptionId),
    );
    if (!allAcrs) return undefined;

    // Attempt to filter ACRs to only those attached to the cluster via AcrPull role
    const attachedAcrs = await longRunning(l10n.t("Checking attached registries..."), () =>
        getAttachedAcrs(sessionProvider, subscriptionId, cluster, allAcrs),
    );

    // If we found attached ACRs, show only those; otherwise fall back to all ACRs
    const acrsToShow = attachedAcrs.length > 0 ? attachedAcrs : allAcrs;
    const showingAttachedOnly = attachedAcrs.length > 0;

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

    // Show confirmation dialog if user cancelled
    if (!selected) {
        return showWizardExitConfirmation(() => selectClusterAcr(sessionProvider, subscriptionId, cluster));
    }

    // If the selected ACR is not yet attached, warn and offer to assign AcrPull automatically.
    // (When showingAttachedOnly is true, every listed ACR already has AcrPull.)
    if (!showingAttachedOnly) {
        await ensureAcrPullForKubelet(sessionProvider, subscriptionId, cluster, selected.acr);
    }

    return selected.acr;
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
            attachedAcrs.push(acr);
        } else {
            logger.debug(`ACR '${acr.name}' is NOT attached to cluster '${cluster.name}' (no AcrPull role)`);
        }
    }

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
            return principalId;
        }
        logger.warn(`Cluster '${cluster.name}' has managed identity but no kubelet identity object ID`);
        return undefined;
    }

    // Fall back to service principal
    const spClientId = managedCluster.servicePrincipalProfile?.clientId;
    if (!spClientId) {
        logger.warn(`Cluster '${cluster.name}' has no kubelet identity or service principal`);
    }
    return spClientId;
}

/** Ensures the cluster's kubelet identity has AcrPull on the given ACR, prompting to assign it if not. */
async function ensureAcrPullForKubelet(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
    acr: AzureResource,
): Promise<void> {
    const principalId = await getClusterPrincipalId(sessionProvider, subscriptionId, cluster);
    if (!principalId) {
        // Cannot determine identity — warn the user.
        vscode.window.showWarningMessage(
            l10n.t(
                "Could not verify AcrPull role for cluster '{0}'. Ensure the AcrPull role is assigned to the cluster's agentpool (kubelet) identity on ACR '{1}' to avoid image-pull errors.",
                cluster.name,
                acr.name,
            ),
        );
        return;
    }

    const authClient = getAuthorizationManagementClient(sessionProvider, subscriptionId);
    const roleAssignments = await getPrincipalRoleAssignmentsForAcr(
        authClient,
        principalId,
        acr.resourceGroup,
        acr.name,
    );

    if (failed(roleAssignments)) {
        logger.warn(`Could not check AcrPull for ACR '${acr.name}': ${roleAssignments.error}`);
        return;
    }

    const hasAcrPull = roleAssignments.result.some((ra) => {
        const roleDefName = ra.roleDefinitionId?.split("/").pop();
        return roleDefName === acrPullRoleDefinitionName;
    });

    if (hasAcrPull) {
        logger.debug(`AcrPull already assigned to kubelet identity for ACR '${acr.name}'`);
        return;
    }

    // AcrPull is missing — prompt the user.
    const assignNow = l10n.t("Assign AcrPull Now");
    const dismiss = l10n.t("Dismiss");
    const choice = await vscode.window.showWarningMessage(
        l10n.t(
            "The AcrPull role is not assigned to the cluster '{0}' agentpool (kubelet) identity on ACR '{1}'. Without it, pods will fail to pull images. Assign the role now?",
            cluster.name,
            acr.name,
        ),
        assignNow,
        dismiss,
    );

    if (choice !== assignNow) {
        return;
    }

    await longRunning(l10n.t("Assigning AcrPull role to cluster agentpool identity..."), async () => {
        const acrScope = getScopeForAcr(subscriptionId, acr.resourceGroup, acr.name);
        const result = await createRoleAssignment(
            authClient,
            subscriptionId,
            principalId,
            acrPullRoleDefinitionName,
            acrScope,
            PRINCIPAL_TYPE_SERVICE_PRINCIPAL,
        );

        if (result.succeeded) {
            vscode.window.showInformationMessage(
                l10n.t(
                    "AcrPull role successfully assigned to cluster '{0}' agentpool identity on ACR '{1}'.",
                    cluster.name,
                    acr.name,
                ),
            );
        } else {
            vscode.window.showErrorMessage(
                l10n.t(
                    "Failed to assign AcrPull role on ACR '{0}': {1}. You may need to assign it manually.",
                    acr.name,
                    result.error,
                ),
            );
        }
    });
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
        prompt: l10n.t("Enter workflow/pipeline name"),
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

    // Show confirmation dialog if user cancelled
    if (!workflowName) {
        return showWizardExitConfirmation(() => promptForWorkflowName(appName));
    }

    logger.debug("Workflow name selected", workflowName);
    return workflowName;
}

export interface AzureContext {
    subscriptionId: string;
    acrName: string;
    acrResourceGroup: string;
    clusterName?: string;
    clusterResourceGroup?: string;
    namespace?: string;
    isManagedNamespace?: boolean;
    workflowName?: string;
}

/**
 * Shared tail for both collectAzureContext paths: prompts for ACR, namespace, and optionally
 * workflow name given an already-resolved session provider, subscription ID, and cluster.
 */
async function collectAzureContextForCluster(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
    hasWorkflow: boolean,
    projectRoot: string,
): Promise<AzureContext | undefined> {
    const namespaceData = await fetchClusterNamespaces(sessionProvider, subscriptionId, cluster);
    const namespaceSelection = await selectClusterNamespace(sessionProvider, subscriptionId, cluster, namespaceData);
    if (!namespaceSelection) return undefined;
    logger.debug(`Namespace selected: ${namespaceSelection.name} (isManaged: ${namespaceSelection.isManaged})`);

    const acr = await selectClusterAcr(sessionProvider, subscriptionId, cluster);
    if (!acr) return undefined;

    const baseContext: AzureContext = {
        subscriptionId,
        acrName: acr.name,
        acrResourceGroup: acr.resourceGroup,
        clusterName: cluster.name,
        clusterResourceGroup: cluster.resourceGroup,
        namespace: namespaceSelection.name,
        isManagedNamespace: namespaceSelection.isManaged,
    };

    if (!hasWorkflow) {
        return baseContext;
    }

    const workflowName = await promptForWorkflowName(path.basename(projectRoot));
    if (!workflowName) return undefined;

    return { ...baseContext, workflowName };
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

    const cluster = await selectAksCluster(sessionProvider, subscription.id);
    if (!cluster) return undefined;
    logger.debug("Cluster selected", cluster.name);

    return collectAzureContextForCluster(sessionProvider, subscription.id, cluster, hasWorkflow, projectRoot);
}

/**
 * Collects Azure context when invoked from the AKS cluster tree.
 * Subscription and cluster are already known from the tree node, so we skip those prompts.
 * Always prompts for ACR and namespace; additionally prompts for workflow name when hasWorkflow is true.
 */
export async function collectAzureContextFromTree(
    subscriptionId: string,
    clusterName: string,
    clusterResourceGroup: string,
    hasWorkflow: boolean,
    projectRoot: string,
): Promise<AzureContext | undefined> {
    const sessionProvider = await authenticateAzure();
    if (!sessionProvider) return undefined;

    const cluster: Cluster = {
        name: clusterName,
        clusterId: `/subscriptions/${subscriptionId}/resourceGroups/${clusterResourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`,
        resourceGroup: clusterResourceGroup,
        subscriptionId,
    };

    return collectAzureContextForCluster(sessionProvider, subscriptionId, cluster, hasWorkflow, projectRoot);
}
