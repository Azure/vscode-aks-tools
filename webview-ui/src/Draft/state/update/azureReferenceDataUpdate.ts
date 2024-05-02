import {
    AcrKey,
    ClusterKey,
    RepositoryKey,
    Subscription,
} from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../../utilities/lazy";
import { AzureReferenceData, SubscriptionReferenceData } from "../stateTypes";
import * as SubscriptionDataUpdate from "./subscriptionDataUpdate";

export function setSubscriptionsLoading(data: AzureReferenceData): AzureReferenceData {
    return { ...data, subscriptions: newLoading() };
}

export function updateSubscriptions(data: AzureReferenceData, subscriptions: Subscription[]): AzureReferenceData {
    const existingSubs = orDefault(data.subscriptions, []);
    const updatedSubs = updateValues(
        existingSubs,
        subscriptions,
        (sub, item) => sub.id === item.subscription.id,
        (subscription) => ({
            subscription,
            acrs: newNotLoaded(),
            clusters: newNotLoaded(),
        }),
    );

    return {
        ...data,
        subscriptions: newLoaded(updatedSubs),
    };
}

export function setAcrsLoading(data: AzureReferenceData, subscriptionId: string): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.setAcrsLoading(sub));
}

export function updateAcrNames(
    data: AzureReferenceData,
    subscriptionId: string,
    acrKeys: AcrKey[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.updateAcrNames(sub, acrKeys));
}

export function setAcrRepositoriesLoading(data: AzureReferenceData, acrKey: AcrKey): AzureReferenceData {
    return updateSubscription(data, acrKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.setAcrRepositoriesLoading(sub, acrKey),
    );
}

export function updateAcrRepositoryNames(
    data: AzureReferenceData,
    acrKey: AcrKey,
    repositoryNames: string[],
): AzureReferenceData {
    return updateSubscription(data, acrKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrRepositoryNames(sub, acrKey, repositoryNames),
    );
}

export function setAcrRepoTagsLoading(data: AzureReferenceData, repositoryKey: RepositoryKey): AzureReferenceData {
    return updateSubscription(data, repositoryKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.setAcrRepoTagsLoading(sub, repositoryKey),
    );
}

export function updateAcrRepoTags(
    data: AzureReferenceData,
    repositoryKey: RepositoryKey,
    tags: string[],
): AzureReferenceData {
    return updateSubscription(data, repositoryKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrRepoTags(sub, repositoryKey, tags),
    );
}

export function setClustersLoading(data: AzureReferenceData, subscriptionId: string): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.setClustersLoading(sub));
}

export function updateClusterNames(
    data: AzureReferenceData,
    subscriptionId: string,
    clusterKeys: ClusterKey[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateClusterNames(sub, clusterKeys),
    );
}

export function setClusterNamespacesLoading(data: AzureReferenceData, clusterKey: ClusterKey): AzureReferenceData {
    return updateSubscription(data, clusterKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.setClusterNamespacesLoading(sub, clusterKey),
    );
}

export function updateClusterNamespaces(
    data: AzureReferenceData,
    clusterKey: ClusterKey,
    namespaceNames: string[],
): AzureReferenceData {
    return updateSubscription(data, clusterKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateClusterNamespaces(sub, clusterKey, namespaceNames),
    );
}

function updateSubscription(
    data: AzureReferenceData,
    subscriptionId: string,
    updater: (data: SubscriptionReferenceData) => SubscriptionReferenceData,
): AzureReferenceData {
    return {
        ...data,
        subscriptions: lazyMap(data.subscriptions, (subs) =>
            replaceItem(subs, (sub) => sub.subscription.id === subscriptionId, updater),
        ),
    };
}
