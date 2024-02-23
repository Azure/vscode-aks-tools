import { Subscription } from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
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
        (sub) => sub.subscription,
        (subscription) => ({
            subscription,
            resourceGroups: newNotLoaded(),
        }),
    );

    return {
        ...data,
        subscriptions: newLoaded(updatedSubs),
    };
}

export function setResourceGroupsLoading(data: AzureReferenceData, subscriptionId: string): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.setResourceGroupsLoading(sub));
}

export function updateResourceGroups(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroups: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateResourceGroups(sub, resourceGroups),
    );
}

export function setAcrsLoading(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.setAcrsLoading(sub, resourceGroup));
}

export function updateAcrNames(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    acrNames: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrNames(sub, resourceGroup, acrNames),
    );
}

export function setAcrRepositoriesLoading(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.setAcrRepositoriesLoading(sub, resourceGroup, acrName),
    );
}

export function updateAcrRepositoryNames(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
    repositoryNames: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrRepositoryNames(sub, resourceGroup, acrName, repositoryNames),
    );
}

export function setAcrRepoTagsLoading(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
    repositoryName: string,
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.setAcrRepoTagsLoading(sub, resourceGroup, acrName, repositoryName),
    );
}

export function updateAcrRepoTags(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    acrName: string,
    repositoryName: string,
    tags: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrRepoTags(sub, resourceGroup, acrName, repositoryName, tags),
    );
}

export function setClustersLoading(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.setClustersLoading(sub, resourceGroup),
    );
}

export function updateClusterNames(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    clusterNames: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateClusterNames(sub, resourceGroup, clusterNames),
    );
}

export function setClusterNamespacesLoading(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.setClusterNamespacesLoading(sub, resourceGroup, clusterName),
    );
}

export function updateClusterNamespaces(
    data: AzureReferenceData,
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
    namespaceNames: string[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateClusterNamespaces(sub, resourceGroup, clusterName, namespaceNames),
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
