import {
    AcrKey,
    ClusterKey,
    RepositoryKey,
    Subscription,
    acrKeysMatch,
    clusterKeysMatch,
    repositoryKeysMatch,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { getOrThrow } from "../../utilities/array";
import { Lazy, isLoaded, isNotLoaded, map as lazyMap, newNotLoaded } from "../../utilities/lazy";
import { EventHandlers } from "../../utilities/state";
import {
    AcrReferenceData,
    AzureReferenceData,
    ClusterReferenceData,
    RepositoryReferenceData,
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

export function ensureClustersLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    updates: EventHandlerFunc[],
): Lazy<ClusterKey[]> {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(subscriptionData.clusters)) {
        const key = { subscriptionId: subscriptionData.subscription.id };
        vscode.postGetClustersRequest(key);
        updates.push((e) => e.onSetClustersLoading(key));
    }

    return lazyMap(subscriptionData.clusters, (data) => data.map((c) => c.key));
}

export function ensureAcrsLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    updates: EventHandlerFunc[],
): Lazy<AcrKey[]> {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(subscriptionData.acrs)) {
        const key = { subscriptionId: subscriptionData.subscription.id };
        vscode.postGetAcrsRequest(key);
        updates.push((e) => e.onSetAcrsLoading(key));
    }

    return lazyMap(subscriptionData.acrs, (data) => data.map((a) => a.key));
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
    if (!isLoaded(referenceData.subscriptions)) {
        return null;
    }

    if (subscription === null) {
        return null;
    }

    return getOrThrow(
        referenceData.subscriptions.value,
        (s) => s.subscription.id === subscription.id,
        `${subscription.id} (${subscription.name}) not found`,
    );
}

function getAcrReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
): AcrReferenceData | null {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null || !isLoaded(subscriptionData.acrs)) {
        return null;
    }

    if (subscription === null || resourceGroup === null || acrName === null) {
        return null;
    }

    const acrKey: AcrKey = { subscriptionId: subscription.id, resourceGroup, acrName };
    return getOrThrow(subscriptionData.acrs.value, (data) => acrKeysMatch(data.key, acrKey), `${acrName} not found`);
}

function getAcrRepositoryReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    acrName: string | null,
    repositoryName: string | null,
): RepositoryReferenceData | null {
    const acrData = getAcrReferenceData(referenceData, subscription, resourceGroup, acrName);
    if (acrData === null || !isLoaded(acrData.repositories)) {
        return null;
    }

    if (subscription === null || resourceGroup === null || acrName === null || repositoryName === null) {
        return null;
    }

    const key: RepositoryKey = { subscriptionId: subscription.id, resourceGroup, acrName, repositoryName };
    return getOrThrow(
        acrData.repositories.value,
        (data) => repositoryKeysMatch(data.key, key),
        `${repositoryName} not found`,
    );
}

function getClusterReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    resourceGroup: string | null,
    clusterName: string | null,
): ClusterReferenceData | null {
    const resourceGroupData = getSubscriptionReferenceData(referenceData, subscription);
    if (resourceGroupData === null || !isLoaded(resourceGroupData.clusters)) {
        return null;
    }

    if (subscription === null || resourceGroup === null || clusterName === null) {
        return null;
    }

    const key: ClusterKey = { subscriptionId: subscription.id, resourceGroup, clusterName };
    return getOrThrow(
        resourceGroupData.clusters.value,
        (data) => clusterKeysMatch(data.key, key),
        `${clusterName} not found`,
    );
}
