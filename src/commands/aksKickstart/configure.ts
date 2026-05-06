import * as vscode from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources, clusterResourceType, acrResourceType } from "../utils/azureResources";
import { getManagedCluster } from "../utils/clusters";
import { getAksClient } from "../utils/arm";
import { failed, Errorable } from "../utils/errorable";
import { ClusterKey, AcrKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { checkKickstartPermissions } from "../utils/kickstartPermissions";

const LAST_USED_KEY = "kickstart.lastUsed";

interface LastUsedSelections {
    subscriptionId?: string;
    clusterName?: string;
    acrName?: string;
}

export interface KickstartConfiguration {
    subscriptionId: string;
    clusterKey: ClusterKey;
    acrKey: AcrKey;
    acrLoginServer: string;
    clusterName: string;
    resourceGroup: string;
    isAutomatic: boolean;
    canGetKubeconfig: boolean;
    hasAcrPull: boolean;
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

    const [skuResult, kubeconfigResult, permissionsResult] = await Promise.all([
        checkClusterSku(sessionProvider.result, clusterKey),
        checkKubeconfigAccess(sessionProvider.result, subscriptionId, clusterKey),
        checkKickstartPermissions(sessionProvider.result, clusterKey, acrKey),
    ]);

    const isAutomatic = !failed(skuResult) && skuResult.result;
    const canGetKubeconfig = !failed(kubeconfigResult) && kubeconfigResult.result;
    const hasAcrPull = !failed(permissionsResult) && permissionsResult.result.hasAcrPull;

    if (context) {
        await context.workspaceState.update(LAST_USED_KEY, {
            subscriptionId: subscriptionId,
            clusterName: clusterPick.resource.name,
            acrName: acrPick.resource.name,
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
            isAutomatic,
            canGetKubeconfig,
            hasAcrPull,
        },
    };
}

async function checkClusterSku(
    sessionProvider: import("../../auth/types").ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
): Promise<Errorable<boolean>> {
    const cluster = await getManagedCluster(
        sessionProvider,
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );
    if (failed(cluster)) {
        return cluster;
    }
    return { succeeded: true, result: cluster.result.sku?.name === "Automatic" };
}

async function checkKubeconfigAccess(
    sessionProvider: import("../../auth/types").ReadyAzureSessionProvider,
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
