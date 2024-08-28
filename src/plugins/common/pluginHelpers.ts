import * as vscode from "vscode";
import { failed, Succeeded } from "../../commands/utils/errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { getResources, DefinedResourceWithGroup } from "../../commands/utils/azureResources";
import { SubscriptionFilter } from "../../commands/utils/config";
import { getSubscriptions, SelectionType } from "../../commands/utils/subscriptions";
import { getResourceManagementClient } from "../../commands/utils/arm";
import { getResourceGroups } from "../../commands/utils/resourceGroups";

type SubscriptionQuickPickItem = vscode.QuickPickItem & { subscription: SubscriptionFilter };

type SuccessResult = { status: "success"; message?: string };
type ErrorResult = { status: "error"; message: string };
type CancelledResult = { status: "cancelled"; message?: string };
export type ReturnResult = SuccessResult | ErrorResult | CancelledResult;

export type SubscriptionSelectionResult = { subscriptionName: string; subscriptionId: string } & ReturnResult;
export async function getSubscriptionSelection(sessionProvider: ReadyAzureSessionProvider): Promise<SubscriptionSelectionResult> {
    const allSubscriptions = await getSubscriptions(sessionProvider, SelectionType.All);

    if (failed(allSubscriptions)) {
        vscode.window.showErrorMessage(allSubscriptions.error);
        return { status: "error", message: allSubscriptions.error, subscriptionId: "", subscriptionName: "" };
    }

    if (allSubscriptions.result.length === 0) {
        const noSubscriptionsFound = "No subscriptions were found. Set up your account if you have yet to do so.";
        const setupAccount = "Set up Account";
        const response = await vscode.window.showInformationMessage(noSubscriptionsFound, setupAccount);
        if (response === setupAccount) {
            vscode.env.openExternal(vscode.Uri.parse("https://azure.microsoft.com/"));
        }

        return { status: "error", message: noSubscriptionsFound, subscriptionId: "", subscriptionName: "" };
    }
    const authSession = await sessionProvider.getAuthSession();

    if (failed(authSession)) {
        vscode.window.showErrorMessage(authSession.error);
        return { status: "error", message: authSession.error, subscriptionId: "", subscriptionName: "" };
    }

    const filteredSubscriptions: SubscriptionFilter[] = await allSubscriptions.result
        .filter((sub) => sub.tenantId === authSession.result.tenantId)
        .map((sub) => ({
            tenantId: sub.tenantId || "",
            subscriptionId: sub.subscriptionId || "",
            label: sub.displayName || "",
        }));

    const quickPickItems: SubscriptionQuickPickItem[] = allSubscriptions.result.map((sub) => {
        return {
            label: sub.displayName || "",
            description: sub.subscriptionId,
            picked: filteredSubscriptions.some((filteredSub) => filteredSub.subscriptionId === sub.subscriptionId), // Set to true if the subscription is in filteredSubscriptions,
            subscription: {
                subscriptionId: sub.subscriptionId || "",
                tenantId: sub.tenantId || "",
            },
        };
    });

    const selectedSubscription = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select Subscription",
    });

    if (!selectedSubscription) {
        return { status: "cancelled", subscriptionId: "", subscriptionName: "" };
    }

    return {
        status: "success",
        subscriptionId: selectedSubscription.subscription.subscriptionId,
        subscriptionName: selectedSubscription.label,
    };
}

export type ClusterResult = { clusterName: string; clusterId: string } & ReturnResult;
export async function getExistingClusterSelection(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<ClusterResult> {
    const clusterResources = await getResources(
        sessionProvider,
        subscriptionId,
        "Microsoft.ContainerService/managedClusters",
    );

    if (failed(clusterResources)) {
        vscode.window.showErrorMessage(
            `Failed to list clusters in subscription ${subscriptionId}: ${clusterResources.error}`,
        );
        return { status: "error", message: clusterResources.error, clusterName: "", clusterId: "" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterItems: any[] = (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.map(
        (cluster) => {
            return {
                label: cluster.name || "",
                description: cluster.id,
                picked: (clusterResources as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(
                    (clusterItem) => clusterItem.name === cluster.name,
                ), // Set to true if the cluster is in clusterResources,
                subscription: {
                    subscriptionId: subscriptionId || "",
                    tenantId: cluster.identity?.tenantId || "",
                },
            };
        },
    );

    const selectedClusterItem = await vscode.window.showQuickPick(clusterItems, {
        canPickMany: false,
        placeHolder: "Select existing AKS Cluster in subscription",
    });

    if (!selectedClusterItem) {
        return { status: "cancelled", clusterName: "", clusterId: "" };
    }

    return { status: "success", clusterName: selectedClusterItem.label, clusterId: selectedClusterItem.description };
}

export type ResourceGroupSelectionResult = { resourceGroupName: string } & ReturnResult;
export async function getResourceGroupSelection(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<ResourceGroupSelectionResult> {
    const resourceGroups = await getResourceGroups(sessionProvider, subscriptionId);

    if (failed(resourceGroups)) {
        vscode.window.showErrorMessage(resourceGroups.error);
        return { status: "error", message: resourceGroups.error, resourceGroupName: "" };
    }

    const rgItems: vscode.QuickPickItem[] = (resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.map(
        (rg) => {
            return {
                label: rg.name || "",
                description: rg.id,
                picked: false, //(resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(rgName => rgName === cluster.name), // Set to true if the cluster is in clusterResources,
            };
        },
    );

    const selectedResourceGroup = await vscode.window.showQuickPick(rgItems, {
        canPickMany: false,
        placeHolder: "Select resource group for the new AKS Cluster",
    });

    if (!selectedResourceGroup) {
        return { status: "cancelled", resourceGroupName: "" };
    }

    return { status: "success", resourceGroupName: selectedResourceGroup.label };
}

export type LocationSelectionResult = { location: string } & ReturnResult;
export async function getLocationSelection(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<LocationSelectionResult> {
    const resourceManagementClient = getResourceManagementClient(sessionProvider, subscriptionId);
    const provider = await resourceManagementClient.providers.get("Microsoft.ContainerService");
    const resourceTypes = provider.resourceTypes?.filter((t) => t.resourceType === "managedClusters");
    if (!resourceTypes || resourceTypes.length > 1) {
        vscode.window.showErrorMessage(
            `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
        );
        return {
            status: "error",
            message: `Unexpected number of managedClusters resource types for provider (${resourceTypes?.length || 0}).`,
            location: "",
        };
    }

    const resourceType = resourceTypes[0];
    if (!resourceType.locations || resourceType.locations.length === 0) {
        vscode.window.showErrorMessage("No locations for managedClusters resource type.");
        return { status: "error", message: "No locations for managedClusters resource type.", location: "" };
    }

    const locationItems: vscode.QuickPickItem[] = resourceType.locations.map((location) => {
        return {
            label: location || "",
            description: "",
            picked: true, //(resourceGroups as unknown as Succeeded<DefinedResourceWithGroup[]>).result.some(rgName => rgName === cluster.name), // Set to true if the cluster is in clusterResources,
        };
    });

    const selectedLocation = await vscode.window.showQuickPick(locationItems, {
        canPickMany: false,
        placeHolder: "Select location for the new AKS Cluster",
    });

    if (!selectedLocation) {
        return { status: "cancelled", location: "" };
    }

    return { status: "success", location: selectedLocation.label };
}

export async function getLocationFromResourceGroup(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroupName: string,
): Promise<string> {
    const resourceManagementClient = getResourceManagementClient(sessionProvider, subscriptionId);
    const provider = await resourceManagementClient.resourceGroups.get(resourceGroupName);
    return provider.location;
}

export function isErrorOrCancelled (result: ReturnResult) {
    if(result.status === "error") {
        return {status: result.status, message: result.message}; 
    } else if (result.status === "cancelled") {
        return {status: result.status, message: result.message};
    }
    return undefined;
}