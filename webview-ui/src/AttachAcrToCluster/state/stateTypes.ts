import {
    Acr,
    Cluster,
    ClusterKey,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { Lazy } from "../../utilities/lazy";

export type AzureReferenceData = {
    subscriptions: Lazy<SubscriptionReferenceData[]>;
};

export type SubscriptionReferenceData = {
    subscription: Subscription;
    acrs: Lazy<AcrReferenceData[]>;
    clusters: Lazy<Cluster[]>;
};

export type AcrReferenceData = {
    acr: Acr;
    assignedRoleDefinitions: {
        [clusterId: string]: Lazy<AcrRoleState>;
    };
};

export type AcrRoleState = {
    hasAcrPull: boolean;
};

export function createClusterId(clusterKey: ClusterKey): string {
    return `${clusterKey.resourceGroup}/${clusterKey.clusterName}`;
}
