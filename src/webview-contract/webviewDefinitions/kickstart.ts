import { WebviewDefinition } from "../webviewTypes";
import { AcrKey, Cluster, ClusterKey, Subscription, SubscriptionKey, Acr } from "./attachAcrToCluster";

export type { AcrKey, ClusterKey, SubscriptionKey };

export interface InitialState {
    initialClusterId?: string;
}

export type ToVsCodeMsgDef = {
    getSubscriptionsRequest: void;
    getResourceGroupsRequest: { subscriptionId: string };
    getClustersRequest: { subscriptionId: string; resourceGroup?: string };
    getAcrsRequest: { subscriptionId: string; resourceGroup?: string };
    getPermissionStatusRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
    attachAcrRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
    startKickstartRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
};

export type ToWebViewMsgDef = {
    getSubscriptionsResponse: { subscriptions: Subscription[] };
    getResourceGroupsResponse: { subscriptionId: string; resourceGroups: string[] };
    getClustersResponse: { key: SubscriptionKey; clusters: Cluster[] };
    getAcrsResponse: { key: SubscriptionKey; acrs: Acr[] };
    getPermissionStatusResponse: { hasAcrPull: boolean; attached: boolean; loading?: boolean; error?: string };
    attachAcrResponse: { succeeded: boolean; error?: string };
    startKickstartResponse: void;
};

export type KickstartDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
