import {
    ActivityFlow,
    ActivitySnapshot,
    ConnectedAcr,
    DeploymentPermissionsSummary,
    ExistingCluster,
    InitialState,
    PostProvisionPermissionsSummary,
    RegionQuotaResult,
    ResourceGroup,
    RoleSummary,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/kickstartCluster";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export enum Stage {
    Uninitialized,
    Loading,
    CollectingInput,
    Provisioning,
    Complete,
}

export type FlowActivity = {
    runId: number;
    stages: ActivitySnapshot[];
};

export type ScanResult = {
    runId: number;
    recommendedRegion: string | null;
    regionResults: RegionQuotaResult[];
    role: RoleSummary;
};

export type FinishResult = {
    succeeded: boolean;
    clusterName: string;
    clusterPortalUrl: string | null;
    acrName: string;
    acrLoginServer: string | null;
};

export type ClusterMode = "createNew" | "useExisting";

export type KickstartClusterState = InitialState & {
    stage: Stage;
    mode: ClusterMode;
    subscriptions: Subscription[] | null;
    locations: string[] | null;
    resourceGroups: ResourceGroup[] | null;
    selectedSubscriptionId: string | null;
    clusters: ExistingCluster[] | null;
    selectedCluster: ExistingCluster | null;
    connectedAcrs: ConnectedAcr[] | null;
    detectingAcrs: boolean;
    activity: Partial<Record<ActivityFlow, FlowActivity>>;
    scan: ScanResult | null;
    errorMessage: string | null;
    preflightCanProceed: boolean | null;
    /** Role verdict from the most recent preflight run; overrides {@link ScanResult.role} for the warning banner. */
    preflightRole: RoleSummary | null;
    /** Deployment-permissions verdict from the most recent preflight run. */
    preflightDeployment: DeploymentPermissionsSummary | null;
    /** Post-provision deployment-permissions check (kubeconfig / RBAC writer / ACR push / ACR Tasks / kubelet AcrPull). */
    postProvisionPermissions: PostProvisionPermissionsSummary | null;
    finishResult: FinishResult | null;
};

export type EventDef = {
    setLoading: void;
    setMode: { mode: ClusterMode };
    setSubscriptionSelected: { subscriptionId: string };
    setExistingClusterSelected: { cluster: ExistingCluster };
    goToExistingClusterSelection: void;
    resetPreflight: void;
    setProvisioning: void;
    retryProvisioning: void;
};

function applySnapshot(existing: FlowActivity | undefined, snapshot: ActivitySnapshot): FlowActivity {
    if (existing && snapshot.runId < existing.runId) {
        return existing;
    }
    if (!existing || snapshot.runId > existing.runId) {
        return { runId: snapshot.runId, stages: [snapshot] };
    }
    const index = existing.stages.findIndex((s) => s.stage === snapshot.stage);
    const stages =
        index >= 0 ? existing.stages.map((s, i) => (i === index ? snapshot : s)) : [...existing.stages, snapshot];
    return { runId: existing.runId, stages };
}

export const stateUpdater: WebviewStateUpdater<"kickstartCluster", EventDef, KickstartClusterState> = {
    createState: (initialState) => ({
        ...initialState,
        stage: Stage.Uninitialized,
        mode: "createNew",
        subscriptions: null,
        locations: null,
        resourceGroups: null,
        selectedSubscriptionId: initialState.lastSubscriptionId,
        clusters: null,
        selectedCluster: null,
        connectedAcrs: null,
        detectingAcrs: false,
        activity: {},
        scan: null,
        errorMessage: null,
        preflightCanProceed: null,
        preflightRole: null,
        preflightDeployment: null,
        postProvisionPermissions: null,
        finishResult: null,
    }),
    vscodeMessageHandler: {
        getSubscriptionsResponse: (state, args) => ({
            ...state,
            subscriptions: args.subscriptions,
            selectedSubscriptionId: state.selectedSubscriptionId ?? args.defaultSubscriptionId,
            stage: Stage.CollectingInput,
        }),
        getLocationsResponse: (state, args) => ({ ...state, locations: args.locations }),
        getResourceGroupsResponse: (state, args) => ({ ...state, resourceGroups: args.groups }),
        activitySnapshot: (state, snapshot) => ({
            ...state,
            activity: { ...state.activity, [snapshot.flow]: applySnapshot(state.activity[snapshot.flow], snapshot) },
        }),
        subscriptionScanComplete: (state, args) => {
            const current = state.activity.subscriptionScan;
            if (current && args.runId < current.runId) {
                return state;
            }
            return {
                ...state,
                scan: {
                    runId: args.runId,
                    recommendedRegion: args.recommendedRegion,
                    regionResults: args.regionResults,
                    role: args.role,
                },
            };
        },
        preflightComplete: (state, args) => ({
            ...state,
            preflightCanProceed: args.canProceed,
            preflightRole: args.role,
            preflightDeployment: args.deployment,
        }),
        finishComplete: (state, args) => ({ ...state, stage: Stage.Complete, finishResult: args }),
        postProvisionPermissionsUpdate: (state, args) => ({ ...state, postProvisionPermissions: args }),
        getClustersResponse: (state, args) =>
            args.subscriptionId === state.selectedSubscriptionId ? { ...state, clusters: args.clusters } : state,
        detectClusterAcrsResponse: (state, args) =>
            state.selectedCluster &&
            args.subscriptionId === state.selectedSubscriptionId &&
            args.clusterResourceGroup === state.selectedCluster.resourceGroup &&
            args.clusterName === state.selectedCluster.name
                ? { ...state, connectedAcrs: args.acrs, detectingAcrs: false }
                : state,
        errorNotification: (state, args) => ({ ...state, errorMessage: args.message }),
    },
    eventHandler: {
        setLoading: (state) => ({ ...state, stage: Stage.Loading }),
        setMode: (state, args) => ({ ...state, mode: args.mode, errorMessage: null }),
        setSubscriptionSelected: (state, args) => ({
            ...state,
            selectedSubscriptionId: args.subscriptionId,
            locations: null,
            resourceGroups: null,
            errorMessage: null,
            scan: null,
            preflightRole: null,
            preflightDeployment: null,
            preflightCanProceed: null,
            postProvisionPermissions: null,
            clusters: null,
            selectedCluster: null,
            connectedAcrs: null,
            detectingAcrs: false,
            activity: { ...state.activity, subscriptionScan: undefined, preflight: undefined },
        }),
        setExistingClusterSelected: (state, args) => ({
            ...state,
            selectedCluster: args.cluster,
            connectedAcrs: null,
            detectingAcrs: true,
        }),
        resetPreflight: (state) => ({
            ...state,
            preflightCanProceed: null,
            preflightRole: null,
            preflightDeployment: null,
            activity: { ...state.activity, preflight: undefined },
        }),
        setProvisioning: (state) => ({ ...state, stage: Stage.Provisioning }),
        retryProvisioning: (state) => ({
            ...state,
            stage: Stage.Provisioning,
            errorMessage: null,
            finishResult: null,
            postProvisionPermissions: null,
            activity: { ...state.activity, provision: undefined },
        }),
        goToExistingClusterSelection: (state) => ({
            ...state,
            stage: Stage.CollectingInput,
            mode: "useExisting",
            errorMessage: null,
            finishResult: null,
            postProvisionPermissions: null,
            selectedCluster: null,
            connectedAcrs: null,
            detectingAcrs: false,
            activity: { ...state.activity, provision: undefined },
        }),
    },
};

export const vscode = getWebviewMessageContext<"kickstartCluster">({
    getSubscriptionsRequest: null,
    getLocationsRequest: null,
    getResourceGroupsRequest: null,
    startSubscriptionScanRequest: null,
    cancelSubscriptionScanRequest: null,
    runPreflightRequest: null,
    finishRequest: null,
    retryProvisioningRequest: null,
    continueInChatRequest: null,
    openDeploymentPermissionsReportRequest: null,
    getClustersRequest: null,
    detectClusterAcrsRequest: null,
    useExistingClusterRequest: null,
});
