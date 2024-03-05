import { Subscription } from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { getOrThrow } from "../../utilities/array";
import { Lazy, isLoaded, isNotLoaded, map as lazyMap, newNotLoaded } from "../../utilities/lazy";
import { EventHandlers } from "../../utilities/state";
import {
    AcrReferenceData,
    AzureReferenceData,
    ClusterReferenceData,
    RepositoryReferenceData,
    ResourceGroupReferenceData,
    SubscriptionReferenceData,
} from "../state/stateTypes";
import { EventDef, vscode } from "./state";

export type EventHandlerFunc = (eventHandlers: EventHandlers<EventDef>) => void;

export function ensureSubscriptionsLoaded(
    referenceData: AzureReferenceData,
    updates: EventHandlerFunc[],
): Lazy<Subscription[]> {
    if (isNotLoaded(referenceData.subscriptions)) {
        vscode.postGetSubscriptionsRequest();
        updates.push((e) => e.onSetSubscriptionsLoading());
    }

    return lazyMap(referenceData.subscriptions, (data) => data.map((s) => s.subscription));
}

export function ensureResourceGroupsLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(subscriptionData.resourceGroups)) {
        vscode.postGetResourceGroupsRequest({ subscriptionId: subscriptionData.subscription.id });
        updates.push((e) => e.onSetResourceGroupsLoading({ subscriptionId: subscriptionData.subscription.id }));
    }

    return lazyMap(subscriptionData.resourceGroups, (data) => data.map((rg) => rg.key.resourceGroup));
}

export function ensureClusterNamesLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const resourceGroupData = getResourceGroupReferenceData(referenceData, subscription, resourceGroup);
    if (resourceGroupData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(resourceGroupData.clusters)) {
        const key = {
            subscriptionId: resourceGroupData.key.subscriptionId,
            resourceGroup: resourceGroupData.key.resourceGroup,
        };
        vscode.postGetClustersRequest(key);
        updates.push((e) => e.onSetClustersLoading(key));
    }

    return lazyMap(resourceGroupData.clusters, (data) => data.map((c) => c.key.clusterName));
}

export function ensureAcrNamesLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const resourceGroupData = getResourceGroupReferenceData(referenceData, subscription, resourceGroup);
    if (resourceGroupData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(resourceGroupData.acrs)) {
        const key = {
            subscriptionId: resourceGroupData.key.subscriptionId,
            resourceGroup: resourceGroupData.key.resourceGroup,
        };
        vscode.postGetAcrsRequest(key);
        updates.push((e) => e.onSetAcrsLoading(key));
    }

    return lazyMap(resourceGroupData.acrs, (data) => data.map((a) => a.key.acrName));
}

export function ensureAcrRepositoryNamesLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const acrData = getAcrReferenceData(referenceData, subscription, resourceGroup, acrName);
    if (acrData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(acrData.repositories)) {
        const key = {
            subscriptionId: acrData.key.subscriptionId,
            resourceGroup: acrData.key.resourceGroup,
            acrName: acrData.key.acrName,
        };
        vscode.postGetRepositoriesRequest(key);
        updates.push((e) => e.onSetRepositoriesLoading(key));
    }

    return lazyMap(acrData.repositories, (data) => data.map((r) => r.key.repositoryName));
}

export function ensureAcrImageTagsLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
    repositoryName: string | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const repositoryData = getAcrRepositoryReferenceData(
        referenceData,
        subscription,
        resourceGroup,
        acrName,
        repositoryName,
    );
    if (repositoryData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(repositoryData.tags)) {
        const key = {
            subscriptionId: repositoryData.key.subscriptionId,
            resourceGroup: repositoryData.key.resourceGroup,
            acrName: repositoryData.key.acrName,
            repositoryName: repositoryData.key.repositoryName,
        };
        vscode.postGetRepoTagsRequest(key);
        updates.push((e) => e.onSetRepoTagsLoading(key));
    }

    return repositoryData.tags;
}

export function ensureClusterNamespacesLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    clusterName: string | null,
    updates: EventHandlerFunc[],
): Lazy<string[]> {
    const clusterData = getClusterReferenceData(referenceData, subscription, resourceGroup, clusterName);
    if (clusterData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(clusterData.namespaces)) {
        const key = {
            subscriptionId: clusterData.key.subscriptionId,
            resourceGroup: clusterData.key.resourceGroup,
            clusterName: clusterData.key.clusterName,
        };
        vscode.postGetNamespacesRequest(key);
        updates.push((e) => e.onSetClusterNamespacesLoading(key));
    }

    return clusterData.namespaces;
}

function getSubscriptionReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
): SubscriptionReferenceData | null {
    if (!isLoaded(referenceData.subscriptions) || subscription === null) {
        return null;
    }

    return getOrThrow(
        referenceData.subscriptions.value,
        (s) => s.subscription.id === subscription.id,
        `${subscription.id} (${subscription.name}) not found`,
    );
}

function getResourceGroupReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
): ResourceGroupReferenceData | null {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return null;
    }

    if (!isLoaded(subscriptionData.resourceGroups) || resourceGroup === null) {
        return null;
    }

    return getOrThrow(
        subscriptionData.resourceGroups.value,
        (rg) => rg.key.resourceGroup === resourceGroup,
        `${resourceGroup} not found`,
    );
}

function getAcrReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
): AcrReferenceData | null {
    const resourceGroupData = getResourceGroupReferenceData(referenceData, subscription, resourceGroup);
    if (resourceGroupData === null) {
        return null;
    }

    if (!isLoaded(resourceGroupData.acrs) || acrName === null) {
        return null;
    }

    return getOrThrow(resourceGroupData.acrs.value, (a) => a.key.acrName === acrName, `${acrName} not found`);
}

function getAcrRepositoryReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
    repositoryName: string | null,
): RepositoryReferenceData | null {
    const acrData = getAcrReferenceData(referenceData, subscription, resourceGroup, acrName);
    if (acrData === null) {
        return null;
    }

    if (!isLoaded(acrData.repositories) || repositoryName === null) {
        return null;
    }

    return getOrThrow(
        acrData.repositories.value,
        (r) => r.key.repositoryName === repositoryName,
        `${repositoryName} not found`,
    );
}

function getClusterReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    clusterName: string | null,
): ClusterReferenceData | null {
    const resourceGroupData = getResourceGroupReferenceData(referenceData, subscription, resourceGroup);
    if (resourceGroupData === null) {
        return null;
    }

    if (!isLoaded(resourceGroupData.clusters) || clusterName === null) {
        return null;
    }

    return getOrThrow(
        resourceGroupData.clusters.value,
        (c) => c.key.clusterName === clusterName,
        `${clusterName} not found`,
    );
}
