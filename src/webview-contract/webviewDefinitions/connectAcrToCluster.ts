import { WebviewDefinition } from "../webviewTypes";

export type SubscriptionKey = {
    subscriptionId: string;
};

export type Subscription = SubscriptionKey & {
    name: string;
};

export type AcrKey = SubscriptionKey & {
    resourceGroup: string;
    acrName: string;
};

export type Acr = AcrKey; // Fully-defined by its key

export type ClusterKey = SubscriptionKey & {
    resourceGroup: string;
    clusterName: string;
};

export type Cluster = ClusterKey; // Fully-defined by its key

// https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
// Role definition names are always guids. Here we want the role definition name for AcrPull.
export const acrPullRoleDefinitionName = "7f951dda-4ed3-4680-a7ca-43fe172d538d";

export type InitialSelection = {
    subscriptionId?: string;
    acrResourceGroup?: string;
    acrName?: string;
    clusterResourceGroup?: string;
    clusterName?: string;
};

export interface InitialState {
    initialSelection: InitialSelection;
}

export type ToVsCodeMsgDef = {
    // Reference data requests
    getSubscriptionsRequest: void;
    getAcrsRequest: SubscriptionKey;
    getClustersRequest: SubscriptionKey;

    // Azure resource role assignment requests
    getAcrRoleAssignmentRequest: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
    };
    createAcrRoleAssignmentRequest: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
    };
    deleteAcrRoleAssignmentRequest: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
    };
};

export type ToWebViewMsgDef = {
    // Reference data responses
    getSubscriptionsResponse: {
        subscriptions: Subscription[];
    };
    getAcrsResponse: {
        key: SubscriptionKey;
        acrs: Acr[];
    };
    getClustersResponse: {
        key: SubscriptionKey;
        clusters: Cluster[];
    };

    // Azure resource role assignment responses
    getAcrRoleAssignmentResponse: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
        hasAcrPull: boolean;
    };
    createAcrRoleAssignmentResponse: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
        hasAcrPull: boolean;
    };
    deleteAcrRoleAssignmentResponse: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
        hasAcrPull: boolean;
    };
};

export type ConnectAcrToClusterDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
