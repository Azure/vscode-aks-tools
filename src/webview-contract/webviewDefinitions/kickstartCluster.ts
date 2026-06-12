import { WebviewDefinition } from "../webviewTypes";
import type { Subscription, ResourceGroup, ActivitySnapshot, RegionQuotaResult, RoleSummary } from "./kickstartShared";

export type {
    Subscription,
    ResourceGroup,
    SetupStepStatus,
    SetupStep,
    ActivityFlow,
    ActivityStatus,
    ActivityEntry,
    ActivitySnapshot,
    RegionQuotaResult,
    RoleSummary,
} from "./kickstartShared";

export interface ClusterLaunchContext {
    appName?: string;
    appSummary?: string;
    suggestedClusterName?: string;
    suggestedAcrName?: string;
    suggestedLocation?: string;
}

export interface ClusterSelections {
    subscriptionId: string;
    subscriptionName: string;
    tenantId: string;
    location: string;
    resourceGroupName: string;
    isNewResourceGroup: boolean;
    clusterName: string;
    acrName: string;
}

export interface ExistingCluster {
    name: string;
    resourceGroup: string;
}

export interface ConnectedAcr {
    name: string;
    resourceGroup: string;
    loginServer: string;
}

export interface ExistingClusterSelection {
    subscriptionId: string;
    subscriptionName: string;
    tenantId: string;
    clusterName: string;
    clusterResourceGroup: string;
    createNewAcr: boolean;
    acrName: string;
    acrResourceGroup: string;
}

export interface InitialState {
    launchContext: ClusterLaunchContext;
    lastSubscriptionId: string | null;
}

export type ToVsCodeMsgDef = {
    getSubscriptionsRequest: void;
    getLocationsRequest: { subscriptionId: string };
    getResourceGroupsRequest: { subscriptionId: string };
    startSubscriptionScanRequest: { subscriptionId: string };
    cancelSubscriptionScanRequest: void;
    runPreflightRequest: { subscriptionId: string; location: string };
    finishRequest: ClusterSelections;
    retryProvisioningRequest: void;
    continueInChatRequest: void;
    getClustersRequest: { subscriptionId: string };
    detectClusterAcrsRequest: { subscriptionId: string; clusterResourceGroup: string; clusterName: string };
    useExistingClusterRequest: ExistingClusterSelection;
};

export type ToWebViewMsgDef = {
    getSubscriptionsResponse: { subscriptions: Subscription[]; defaultSubscriptionId: string | null };
    getLocationsResponse: { locations: string[] };
    getResourceGroupsResponse: { groups: ResourceGroup[] };
    activitySnapshot: ActivitySnapshot;
    subscriptionScanComplete: {
        runId: number;
        recommendedRegion: string | null;
        regionResults: RegionQuotaResult[];
        role: RoleSummary;
    };
    preflightComplete: { canProceed: boolean };
    finishComplete: {
        succeeded: boolean;
        clusterName: string;
        clusterPortalUrl: string | null;
        acrName: string;
        acrLoginServer: string | null;
    };
    getClustersResponse: { subscriptionId: string; clusters: ExistingCluster[] };
    detectClusterAcrsResponse: {
        subscriptionId: string;
        clusterResourceGroup: string;
        clusterName: string;
        acrs: ConnectedAcr[];
    };
    errorNotification: { message: string };
};

export type KickstartClusterDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
