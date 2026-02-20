import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getSubscriptions, SelectionType } from "../utils/subscriptions";
import { getResources } from "../utils/azureResources";
import { getClusters, Cluster, getClusterNamespaces, getManagedCluster } from "../utils/clusters";
import { extension } from "vscode-kubernetes-tools-api";

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
    const managedCluster = await getManagedCluster(
        sessionProvider,
        subscriptionId,
        cluster.resourceGroup,
        cluster.name,
    );

    if (!managedCluster.succeeded) {
        vscode.window.showErrorMessage(managedCluster.error);
        return undefined;
    }

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

    const acrItems = acrsResult.result
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((acr) => ({
            label: acr.name,
            description: acr.resourceGroup,
            detail: l10n.t("Ensure this ACR is attached to cluster '{0}'", cluster.name),
            acr: {
                id: acr.id,
                name: acr.name,
                resourceGroup: acr.resourceGroup,
            },
        }));

    const selected = await vscode.window.showQuickPick(acrItems, {
        placeHolder: l10n.t("Select Azure Container Registry attached to '{0}'", cluster.name),
        title: l10n.t("Container Registry ({0} available)", acrsResult.result.length),
    });

    return selected?.acr;
}

/**
 * Prompts user to select an ACR from the subscription (no cluster required).
 * Returns the AzureResource for the selected ACR.
 */
export async function selectAcr(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<AzureResource | undefined> {
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

    const acrItems = acrsResult.result
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
        title: l10n.t("Container Registry ({0} available)", acrsResult.result.length),
    });

    return selected?.acr;
}
