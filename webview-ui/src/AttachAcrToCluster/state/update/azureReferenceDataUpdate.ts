import {
    AcrKey,
    ClusterKey,
    Subscription,
} from "../../../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
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
        (sub, subData) => sub.subscriptionId === subData.subscription.subscriptionId,
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
    return updateSubscription(data, subscriptionId, (sub) => ({ ...sub, acrs: newLoading() }));
}

export function updateAcrs(data: AzureReferenceData, subscriptionId: string, acrKeys: AcrKey[]): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => SubscriptionDataUpdate.updateAcrs(sub, acrKeys));
}

export function setClustersLoading(data: AzureReferenceData, subscriptionId: string): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => ({ ...sub, clusters: newLoading() }));
}

export function updateClusters(
    data: AzureReferenceData,
    subscriptionId: string,
    clusterKeys: ClusterKey[],
): AzureReferenceData {
    return updateSubscription(data, subscriptionId, (sub) => ({ ...sub, clusters: newLoaded(clusterKeys) }));
}

export function setAcrRoleAssignmentLoading(
    data: AzureReferenceData,
    acrKey: AcrKey,
    clusterKey: ClusterKey,
): AzureReferenceData {
    return updateSubscription(data, acrKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.setAcrRoleAssignmentLoading(sub, acrKey, clusterKey),
    );
}

export function updateAcrRoleAssignment(
    data: AzureReferenceData,
    acrKey: AcrKey,
    clusterKey: ClusterKey,
    hasAcrPull: boolean,
): AzureReferenceData {
    return updateSubscription(data, acrKey.subscriptionId, (sub) =>
        SubscriptionDataUpdate.updateAcrRoleAssignment(sub, acrKey, clusterKey, hasAcrPull),
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
            replaceItem(subs, (subData) => subData.subscription.subscriptionId === subscriptionId, updater),
        ),
    };
}
