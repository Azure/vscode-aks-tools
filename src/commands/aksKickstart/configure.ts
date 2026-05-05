import * as vscode from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources, clusterResourceType, acrResourceType } from "../utils/azureResources";
import { getManagedCluster } from "../utils/clusters";
import { getAksClient } from "../utils/arm";
import { failed, Errorable } from "../utils/errorable";
import { ClusterKey, AcrKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { checkKickstartPermissions } from "../utils/kickstartPermissions";

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
export async function configureKickstart(): Promise<Errorable<KickstartConfiguration>> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        return { succeeded: false, error: "Azure sign-in is required." };
    }

    const subsResult = await getSubscriptions(sessionProvider.result, SelectionType.AllIfNoFilters);
    if (failed(subsResult)) {
        return { succeeded: false, error: `Failed to load subscriptions: ${subsResult.error}` };
    }
    if (subsResult.result.length === 0) {
        return { succeeded: false, error: "No Azure subscriptions found." };
    }

    const subPick = await vscode.window.showQuickPick(
        subsResult.result.map((s) => ({ label: s.displayName, description: s.subscriptionId, sub: s })),
        { placeHolder: "Select an Azure subscription", ignoreFocusOut: true },
    );
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

    const clusterPick = await vscode.window.showQuickPick(
        clustersResult.result.map((c) => ({
            label: c.name,
            description: c.resourceGroup,
            resource: c,
        })),
        { placeHolder: "Select an AKS cluster", ignoreFocusOut: true },
    );
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

    const acrPick = await vscode.window.showQuickPick(
        acrsResult.result.map((a) => ({
            label: a.name,
            description: a.resourceGroup,
            resource: a,
        })),
        { placeHolder: "Select a container registry", ignoreFocusOut: true },
    );
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
