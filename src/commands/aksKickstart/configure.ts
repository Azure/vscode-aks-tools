import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources, clusterResourceType, acrResourceType } from "../utils/azureResources";
import { getClusterNamespacesWithTypes, getManagedCluster, NamespaceWithType } from "../utils/clusters";
import { getAksClient } from "../utils/arm";
import { failed, Errorable } from "../utils/errorable";
import { ClusterKey, AcrKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { checkKickstartPermissions } from "../utils/kickstartPermissions";
import { DeployRbacCheckResult, checkUserDeployRbac } from "../utils/aksRbacHelpers";

const LAST_USED_KEY = "kickstart.lastUsed";
const DEFAULT_NAMESPACE = "default";

interface LastUsedSelections {
    subscriptionId?: string;
    clusterName?: string;
    acrName?: string;
    namespace?: string;
}

export interface KickstartConfiguration {
    subscriptionId: string;
    clusterKey: ClusterKey;
    acrKey: AcrKey;
    acrLoginServer: string;
    clusterName: string;
    resourceGroup: string;
    namespace: string;
    isAutomatic: boolean;
    canGetKubeconfig: boolean;
    hasAcrPull: boolean;
    /** RBAC pre-flight for the signed-in user (cluster + ACR). Undefined if cluster fetch failed. */
    userDeployRbac?: DeployRbacCheckResult;
}

/**
 * Runs a QuickPick-based flow to select subscription → cluster → ACR,
 * then performs pre-flight checks (SKU detection, kubeconfig access, ACR permissions).
 * Designed to be invoked from a chat button command.
 */
export async function configureKickstart(
    context?: vscode.ExtensionContext,
): Promise<Errorable<KickstartConfiguration>> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        return { succeeded: false, error: "Azure sign-in is required." };
    }

    const lastUsed: LastUsedSelections = context?.workspaceState.get(LAST_USED_KEY) ?? {};

    const subsResult = await getSubscriptions(sessionProvider.result, SelectionType.AllIfNoFilters);
    if (failed(subsResult)) {
        return { succeeded: false, error: `Failed to load subscriptions: ${subsResult.error}` };
    }
    if (subsResult.result.length === 0) {
        return { succeeded: false, error: "No Azure subscriptions found." };
    }

    const subItems = subsResult.result.map((s) => ({ label: s.displayName, description: s.subscriptionId, sub: s }));
    const lastSubIndex = subItems.findIndex((i) => i.sub.subscriptionId === lastUsed.subscriptionId);
    if (lastSubIndex > 0) {
        const [item] = subItems.splice(lastSubIndex, 1);
        item.description = `${item.description} (last used)`;
        subItems.unshift(item);
    }

    const subPick = await vscode.window.showQuickPick(subItems, {
        placeHolder: "Select an Azure subscription",
        ignoreFocusOut: true,
    });
    if (!subPick) {
        return { succeeded: false, error: "Cancelled." };
    }
    const subscriptionId = subPick.sub.subscriptionId;

    const clustersResult = await getResources(sessionProvider.result, subscriptionId, clusterResourceType);
    if (failed(clustersResult)) {
        return { succeeded: false, error: `Failed to load clusters: ${clustersResult.error}` };
    }
    if (clustersResult.result.length === 0) {
        return { succeeded: false, error: "No AKS clusters found in this subscription." };
    }

    const clusterItems = clustersResult.result.map((c) => ({
        label: c.name,
        description: c.resourceGroup,
        resource: c,
    }));
    const lastClusterIndex = clusterItems.findIndex((i) => i.resource.name === lastUsed.clusterName);
    if (lastClusterIndex > 0) {
        const [item] = clusterItems.splice(lastClusterIndex, 1);
        item.description = `${item.description} (last used)`;
        clusterItems.unshift(item);
    }

    const clusterPick = await vscode.window.showQuickPick(clusterItems, {
        placeHolder: "Select an AKS cluster",
        ignoreFocusOut: true,
    });
    if (!clusterPick) {
        return { succeeded: false, error: "Cancelled." };
    }

    const clusterKey: ClusterKey = {
        subscriptionId,
        resourceGroup: clusterPick.resource.resourceGroup,
        clusterName: clusterPick.resource.name,
    };

    const namespaceResult = await pickNamespace(sessionProvider.result, clusterKey, lastUsed.namespace);
    if (failed(namespaceResult)) {
        return { succeeded: false, error: namespaceResult.error };
    }
    const namespace = namespaceResult.result;

    const acrsResult = await getResources(sessionProvider.result, subscriptionId, acrResourceType);
    if (failed(acrsResult)) {
        return { succeeded: false, error: `Failed to load registries: ${acrsResult.error}` };
    }
    if (acrsResult.result.length === 0) {
        return { succeeded: false, error: "No container registries found in this subscription." };
    }

    const acrItems = acrsResult.result.map((a) => ({
        label: a.name,
        description: a.resourceGroup,
        resource: a,
    }));
    const lastAcrIndex = acrItems.findIndex((i) => i.resource.name === lastUsed.acrName);
    if (lastAcrIndex > 0) {
        const [item] = acrItems.splice(lastAcrIndex, 1);
        item.description = `${item.description} (last used)`;
        acrItems.unshift(item);
    }

    const acrPick = await vscode.window.showQuickPick(acrItems, {
        placeHolder: "Select a container registry",
        ignoreFocusOut: true,
    });
    if (!acrPick) {
        return { succeeded: false, error: "Cancelled." };
    }

    const acrKey: AcrKey = {
        subscriptionId,
        resourceGroup: acrPick.resource.resourceGroup,
        acrName: acrPick.resource.name,
    };
    const acrLoginServer = `${acrPick.resource.name.toLowerCase()}.azurecr.io`;

    // Fetch the cluster once; SKU + RBAC checks both consume it.
    const clusterResult = await getManagedCluster(
        sessionProvider.result,
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );

    const [kubeconfigResult, permissionsResult, rbacResult] = await Promise.all([
        checkKubeconfigAccess(sessionProvider.result, subscriptionId, clusterKey),
        checkKickstartPermissions(sessionProvider.result, clusterKey, acrKey),
        !failed(clusterResult)
            ? checkUserDeployRbac(sessionProvider.result, clusterKey, clusterResult.result, acrKey)
            : Promise.resolve<Errorable<DeployRbacCheckResult>>({
                  succeeded: false,
                  error: clusterResult.error,
              }),
    ]);

    const isAutomatic = !failed(clusterResult) && clusterResult.result.sku?.name === "Automatic";
    const canGetKubeconfig = !failed(kubeconfigResult) && kubeconfigResult.result;
    const hasAcrPull = !failed(permissionsResult) && permissionsResult.result.hasAcrPull;
    const userDeployRbac = !failed(rbacResult) ? rbacResult.result : undefined;

    if (context) {
        await context.workspaceState.update(LAST_USED_KEY, {
            subscriptionId: subscriptionId,
            clusterName: clusterPick.resource.name,
            acrName: acrPick.resource.name,
            namespace,
        });
    }

    return {
        succeeded: true,
        result: {
            subscriptionId,
            clusterKey,
            acrKey,
            acrLoginServer,
            clusterName: clusterPick.resource.name,
            resourceGroup: clusterPick.resource.resourceGroup,
            namespace,
            isAutomatic,
            canGetKubeconfig,
            hasAcrPull,
            userDeployRbac,
        },
    };
}

async function checkKubeconfigAccess(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    clusterKey: ClusterKey,
): Promise<Errorable<boolean>> {
    const client = getAksClient(sessionProvider, subscriptionId);
    try {
        await client.managedClusters.listClusterUserCredentials(clusterKey.resourceGroup, clusterKey.clusterName);
        return { succeeded: true, result: true };
    } catch {
        return { succeeded: true, result: false };
    }
}

type NamespacePickItem = vscode.QuickPickItem & { name: string };

/**
 * Lets the user pick an existing namespace from the cluster. System namespaces
 * (kube-system, kube-public, kube-node-lease, kube-lease) are filtered out, but
 * "default" is always offered. Returns an error if kubectl is unavailable or
 * the cluster's namespaces cannot be listed.
 */
async function pickNamespace(
    sessionProvider: ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
    lastUsed: string | undefined,
): Promise<Errorable<string>> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        return { succeeded: false, error: "kubectl is not available — cannot list cluster namespaces." };
    }

    const nsResult = await getClusterNamespacesWithTypes(
        sessionProvider,
        kubectl,
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );
    if (failed(nsResult)) {
        return { succeeded: false, error: `Could not list namespaces: ${nsResult.error}` };
    }

    const orderedNames = orderNamespacesForPick(nsResult.result, lastUsed);
    if (orderedNames.length === 0) {
        return { succeeded: false, error: "No user namespaces found on the cluster." };
    }
    const items: NamespacePickItem[] = orderedNames.map((name) => ({
        label: name,
        description: name === lastUsed ? "(last used)" : name === DEFAULT_NAMESPACE ? "(default)" : undefined,
        name,
    }));

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a Kubernetes namespace for your application",
        ignoreFocusOut: true,
    });
    if (!pick) {
        return { succeeded: false, error: "Cancelled." };
    }
    return { succeeded: true, result: pick.name };
}

/**
 * Returns non-system namespace names, with "default" always first and the
 * last-used namespace promoted to the top when present.
 */
function orderNamespacesForPick(namespaces: NamespaceWithType[], lastUsed: string | undefined): string[] {
    const names = new Set<string>();
    if (namespaces.some((n) => n.name === DEFAULT_NAMESPACE)) {
        names.add(DEFAULT_NAMESPACE);
    }
    for (const ns of namespaces) {
        if (ns.type === "system") continue;
        names.add(ns.name);
    }
    const ordered = [...names].sort();
    if (lastUsed && names.has(lastUsed)) {
        return [lastUsed, ...ordered.filter((n) => n !== lastUsed)];
    }
    return ordered;
}
