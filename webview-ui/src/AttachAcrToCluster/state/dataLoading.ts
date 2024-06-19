import {
    Acr,
    AcrKey,
    Cluster,
    ClusterKey,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { getOrThrow } from "../../utilities/array";
import { Lazy, isLoaded, isNotLoaded, map as lazyMap, newNotLoaded } from "../../utilities/lazy";
import { EventHandlers } from "../../utilities/state";
import {
    AcrReferenceData,
    AcrRoleState,
    AzureReferenceData,
    SubscriptionReferenceData,
    createClusterId,
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

export function ensureAcrsLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    updates: EventHandlerFunc[],
): Lazy<Acr[]> {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(subscriptionData.acrs)) {
        const key = { subscriptionId: subscriptionData.subscription.subscriptionId };
        vscode.postGetAcrsRequest(key);
        updates.push((e) => e.onSetAcrsLoading(key));
    }

    return lazyMap(subscriptionData.acrs, (data) => data.map((a) => a.acr));
}

export function ensureClustersLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    updates: EventHandlerFunc[],
): Lazy<Cluster[]> {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null) {
        return newNotLoaded();
    }

    if (isNotLoaded(subscriptionData.clusters)) {
        const key = { subscriptionId: subscriptionData.subscription.subscriptionId };
        vscode.postGetClustersRequest(key);
        updates.push((e) => e.onSetClustersLoading(key));
    }

    return subscriptionData.clusters;
}

export function ensureAcrRoleAssignmentLoaded(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    acrKey: AcrKey | null,
    clusterKey: ClusterKey | null,
    updates: EventHandlerFunc[],
): Lazy<AcrRoleState> {
    const acrData = getAcrReferenceData(referenceData, subscription, acrKey);
    if (acrData === null || clusterKey === null) {
        return newNotLoaded();
    }

    const assignedRoleDefinitions: Lazy<AcrRoleState> =
        acrData.assignedRoleDefinitions[createClusterId(clusterKey)] || newNotLoaded();

    if (isNotLoaded(assignedRoleDefinitions)) {
        const acrKey: AcrKey = {
            subscriptionId: acrData.acr.subscriptionId,
            resourceGroup: acrData.acr.resourceGroup,
            acrName: acrData.acr.acrName,
        };

        vscode.postGetAcrRoleAssignmentRequest({ acrKey, clusterKey });
        updates.push((e) => e.onSetAcrRoleAssignmentLoading({ acrKey, clusterKey }));
    }

    return assignedRoleDefinitions;
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
        (s) => s.subscription.subscriptionId === subscription.subscriptionId,
        `${subscription.subscriptionId} (${subscription.name}) not found`,
    );
}

function getAcrReferenceData(
    referenceData: AzureReferenceData,
    subscription: Subscription | null,
    acr: Acr | null,
): AcrReferenceData | null {
    const subscriptionData = getSubscriptionReferenceData(referenceData, subscription);
    if (subscriptionData === null || !isLoaded(subscriptionData.acrs) || subscription === null || acr === null) {
        return null;
    }

    return getOrThrow(
        subscriptionData.acrs.value,
        (data) => data.acr.resourceGroup === acr.resourceGroup && data.acr.acrName === acr.acrName,
        `${acr.acrName} not found`,
    );
}
