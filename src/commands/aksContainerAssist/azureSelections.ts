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
import { getPrincipalRoleAssignmentsForAcr, createRoleAssignment, getScopeForAcr } from "../utils/roleAssignments";
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

    if (failed(clustersResult) || clustersResult.result.length === 0) {
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

    const clusters = clustersResult.result;
    const clusterItems = clusters
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cluster) => ({
            label: cluster.name,
            description: cluster.resourceGroup,
            cluster,
        }));

    const selected = await vscode.window.showQuickPick(clusterItems, {
        placeHolder: l10n.t("Select AKS cluster for deployment"),
        title: l10n.t("AKS Cluster ({0} available)", clusters.length),
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

    if (!namespacesResult.succeeded && !isNamespacesListForbidden(namespacesResult.error)) {
        vscode.window.showErrorMessage(
            l10n.t("Failed to retrieve namespaces from cluster: {0}", namespacesResult.error),
        );
        return undefined;
    }

    if (!namespacesResult.succeeded) {
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

        const hasAcrPull = roleAssignments.result.some((ra) => {
            if (!ra.roleDefinitionId) return false;
            const roleDefName = ra.roleDefinitionId.split("/").pop();
            return roleDefName === acrPullRoleDefinitionName;
        });

        if (hasAcrPull) {
            attachedAcrs.push(acr);
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
            "ServicePrincipal",
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

    return workflowName;
}

export interface AzureContext {
    subscriptionId: string;
    /** ACR name — set when the image is sourced from an Azure Container Registry. */
    acrName?: string;
    /** ACR resource group — set when the image is sourced from an Azure Container Registry. */
    acrResourceGroup?: string;
    /**
     * Full container image reference (e.g. `ghcr.io/org/app:latest`) to use in the generated
     * manifests when the user opts out of ACR. Mutually exclusive with `acrName`.
     */
    customImage?: string;
    clusterName?: string;
    clusterResourceGroup?: string;
    namespace?: string;
    isManagedNamespace?: boolean;
    workflowName?: string;
}

/** The resolved container image source: either an ACR or a user-supplied image reference. */
interface ImageSourceSelection {
    acrName?: string;
    acrResourceGroup?: string;
    customImage?: string;
}

/** Prompts for a full container image reference (registry/repository[:tag]) to use in the manifests. */
async function promptForCustomImage(): Promise<string | undefined> {
    const image = await vscode.window.showInputBox({
        prompt: l10n.t(
            "Enter the full container image reference to use in the manifests (e.g. ghcr.io/org/app:latest).",
        ),
        placeHolder: "ghcr.io/org/app:latest",
        ignoreFocusOut: true,
        validateInput: (value) => {
            const v = value?.trim() ?? "";
            if (!v) return l10n.t("Image reference is required");
            if (/\s/.test(v)) return l10n.t("Image reference cannot contain spaces");
            return undefined;
        },
    });

    // Show confirmation dialog if user cancelled
    if (!image) {
        return showWizardExitConfirmation(() => promptForCustomImage());
    }

    return image.trim();
}

async function selectAcrImageSource(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
): Promise<ImageSourceSelection | undefined> {
    const acr = await selectClusterAcr(sessionProvider, subscriptionId, cluster);
    return acr ? { acrName: acr.name, acrResourceGroup: acr.resourceGroup } : undefined;
}

/**
 * Resolves the container image source for the manifests. When `requireAcr` is true (a workflow is
 * also generated, which builds/pushes to ACR) an ACR must be selected; otherwise the user may
 * instead point the manifests at an existing image reference (GHCR, Docker Hub, etc.).
 */
async function selectImageSource(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    cluster: Cluster,
    requireAcr: boolean,
): Promise<ImageSourceSelection | undefined> {
    if (requireAcr) {
        return selectAcrImageSource(sessionProvider, subscriptionId, cluster);
    }

    const acrChoice = {
        label: l10n.t("$(cloud) Use an Azure Container Registry"),
        description: l10n.t("Select an ACR attached to the cluster"),
        sourceType: "acr" as const,
    };
    const customChoice = {
        label: l10n.t("$(link) Use an existing image reference"),
        description: l10n.t("Point manifests at an image you already have (e.g. GHCR, Docker Hub)"),
        sourceType: "custom" as const,
    };

    const picked = await vscode.window.showQuickPick([acrChoice, customChoice], {
        placeHolder: l10n.t("Select the container image source for the manifests"),
        title: l10n.t("Container Image Source"),
    });

    if (!picked) {
        return showWizardExitConfirmation(() =>
            selectImageSource(sessionProvider, subscriptionId, cluster, requireAcr),
        );
    }

    if (picked.sourceType === "acr") {
        return selectAcrImageSource(sessionProvider, subscriptionId, cluster);
    }

    const customImage = await promptForCustomImage();
    if (!customImage) return undefined;
    return { customImage };
}

/**
 * Shared tail for both collectAzureContext paths: prompts for namespace, image source, and
 * optionally workflow name given an already-resolved session provider, subscription ID, and cluster.
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

    // ACR is mandatory when a workflow is also generated (it builds/pushes the image to ACR);
    // for deployment-only, the user may instead point the manifests at an existing image.
    const imageSource = await selectImageSource(sessionProvider, subscriptionId, cluster, hasWorkflow);
    if (!imageSource) return undefined;

    const baseContext: AzureContext = {
        subscriptionId,
        acrName: imageSource.acrName,
        acrResourceGroup: imageSource.acrResourceGroup,
        customImage: imageSource.customImage,
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

    const cluster = await selectAksCluster(sessionProvider, subscription.id);
    if (!cluster) return undefined;

    return collectAzureContextForCluster(sessionProvider, subscription.id, cluster, hasWorkflow, projectRoot);
}

/**
 * Collects Azure context when invoked from the AKS cluster tree.
 * Subscription and cluster are already known from the tree node, so we skip those prompts.
 * Always prompts for namespace and image source; ACR is required only when hasWorkflow is true,
 * in which case it additionally prompts for the workflow name.
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
