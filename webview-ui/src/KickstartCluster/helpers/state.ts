import {
    ActivityFlow,
    ActivitySnapshot,
    ConnectedAcr,
    CostEstimate,
    DeploymentPermissionsSummary,
    ExistingCluster,
    InitialState,
    ProvisioningAccessPrompt,
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
};

export type FinishResult = {
    succeeded: boolean;
    clusterName: string;
    clusterPortalUrl: string | null;
    acrName: string;
    acrLoginServer: string | null;
};

export type CostEstimateResult = {
    location: string;
    estimate: CostEstimate | null;
    error: string | null;
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
    existingReadiness: DeploymentPermissionsSummary | null;
    existingReadinessKey: string | null;
    activity: Partial<Record<ActivityFlow, FlowActivity>>;
    scan: ScanResult | null;
    errorMessage: string | null;
    preflightCanProceed: boolean | null;
    /** Role verdict from the most recent preflight run; drives the form's permission warning banner. */
    preflightRole: RoleSummary | null;
    /** Deployment-permissions verdict from the most recent preflight run. */
    preflightDeployment: DeploymentPermissionsSummary | null;
    preflightReadiness: DeploymentPermissionsSummary | null;
    /** Incremented each time the user requests a manual re-check; causes the preflight effect to re-fire. */
    preflightGeneration: number;
    provisioningAccess: ProvisioningAccessPrompt | null;
    finishResult: FinishResult | null;
    /**
     * True once the extension reports the cluster's kubelet identity has been granted AcrPull while
     * the cluster is still provisioning, so the Provisioning view can offer an early "Continue in
     * chat" handoff. Persists across single-stage retries but resets on a fresh/abandoned run.
     */
    clusterChatReady: boolean;
    costEstimate: CostEstimateResult | null;
};

export type EventDef = {
    setLoading: void;
    setMode: { mode: ClusterMode };
    setSubscriptionSelected: { subscriptionId: string };
    setExistingClusterSelected: { cluster: ExistingCluster };
    setExistingReadinessPending: { key: string };
    goToExistingClusterSelection: void;
    resetPreflight: void;
    recheckPermissions: void;
    setProvisioning: void;
    retryProvisioning: void;
    retryProvisioningStage: void;
    backToSetup: void;
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
        existingReadiness: null,
        existingReadinessKey: null,
        activity: {},
        scan: null,
        errorMessage: null,
        preflightCanProceed: null,
        preflightRole: null,
        preflightDeployment: null,
        preflightReadiness: null,
        preflightGeneration: 0,
        provisioningAccess: null,
        finishResult: null,
        clusterChatReady: false,
        costEstimate: null,
    }),
    vscodeMessageHandler: {
        getSubscriptionsResponse: (state, args) => {
            const available = new Set(args.subscriptions.map((s) => s.id));
            const preferred = [state.selectedSubscriptionId, args.defaultSubscriptionId].find(
                (id) => id !== null && available.has(id),
            );
            return {
                ...state,
                subscriptions: args.subscriptions,
                selectedSubscriptionId: preferred ?? args.subscriptions[0]?.id ?? null,
                stage: Stage.CollectingInput,
            };
        },
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
                },
            };
        },
        preflightComplete: (state, args) => ({
            ...state,
            preflightCanProceed: args.canProceed,
            preflightRole: args.role,
            preflightDeployment: args.deployment,
            preflightReadiness: args.readiness,
        }),
        finishComplete: (state, args) => ({
            ...state,
            stage: Stage.Complete,
            finishResult: args,
            provisioningAccess: null,
        }),
        clusterChatReady: (state) => ({ ...state, clusterChatReady: true }),
        awaitingProvisioningAccess: (state, args) => ({ ...state, provisioningAccess: args }),
        provisioningAccessResolved: (state, args) =>
            state.provisioningAccess && state.provisioningAccess.runId !== args.runId
                ? state
                : { ...state, provisioningAccess: null },
        getClustersResponse: (state, args) =>
            args.subscriptionId === state.selectedSubscriptionId ? { ...state, clusters: args.clusters } : state,
        detectClusterAcrsResponse: (state, args) =>
            state.selectedCluster &&
            args.subscriptionId === state.selectedSubscriptionId &&
            args.clusterResourceGroup === state.selectedCluster.resourceGroup &&
            args.clusterName === state.selectedCluster.name
                ? { ...state, connectedAcrs: args.acrs, detectingAcrs: false }
                : state,
        getCostEstimateResponse: (state, args) => ({
            ...state,
            costEstimate: { location: args.location, estimate: args.estimate, error: args.error },
        }),
        existingReadinessComplete: (state, args) =>
            args.requestKey === state.existingReadinessKey ? { ...state, existingReadiness: args.readiness } : state,
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
            preflightReadiness: null,
            preflightCanProceed: null,
            clusters: null,
            selectedCluster: null,
            connectedAcrs: null,
            detectingAcrs: false,
            existingReadiness: null,
            existingReadinessKey: null,
            costEstimate: null,
            activity: { ...state.activity, subscriptionScan: undefined, preflight: undefined },
        }),
        setExistingClusterSelected: (state, args) => ({
            ...state,
            selectedCluster: args.cluster,
            connectedAcrs: null,
            detectingAcrs: true,
            existingReadiness: null,
            existingReadinessKey: null,
        }),
        setExistingReadinessPending: (state, args) => ({
            ...state,
            existingReadinessKey: args.key,
            existingReadiness: null,
        }),
        resetPreflight: (state) => ({
            ...state,
            preflightCanProceed: null,
            preflightRole: null,
            preflightDeployment: null,
            preflightReadiness: null,
            activity: { ...state.activity, preflight: undefined },
        }),
        recheckPermissions: (state) => ({
            ...state,
            preflightCanProceed: null,
            preflightRole: null,
            preflightDeployment: null,
            preflightReadiness: null,
            preflightGeneration: state.preflightGeneration + 1,
            activity: { ...state.activity, preflight: undefined },
        }),
        setProvisioning: (state) => ({
            ...state,
            stage: Stage.Provisioning,
            provisioningAccess: null,
            clusterChatReady: false,
        }),
        retryProvisioning: (state) => ({
            ...state,
            stage: Stage.Provisioning,
            errorMessage: null,
            finishResult: null,
            provisioningAccess: null,
            clusterChatReady: false,
            activity: { ...state.activity, provision: undefined },
        }),
        // Unlike retryProvisioning, this keeps activity.provision so the re-run's snapshots merge
        // back into the existing stages (same runId) instead of starting a fresh stage list.
        retryProvisioningStage: (state) => ({
            ...state,
            stage: Stage.Provisioning,
            errorMessage: null,
            finishResult: null,
            provisioningAccess: null,
        }),
        // Returns to the setup form while preserving the user's selections; clears only the
        // abandoned run's transient provisioning state (the panel cancels the in-flight attempt).
        backToSetup: (state) => ({
            ...state,
            stage: Stage.CollectingInput,
            errorMessage: null,
            finishResult: null,
            provisioningAccess: null,
            clusterChatReady: false,
            activity: { ...state.activity, provision: undefined },
        }),
        goToExistingClusterSelection: (state) => ({
            ...state,
            stage: Stage.CollectingInput,
            mode: "useExisting",
            errorMessage: null,
            finishResult: null,
            clusterChatReady: false,
            selectedCluster: null,
            connectedAcrs: null,
            detectingAcrs: false,
            existingReadiness: null,
            existingReadinessKey: null,
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
    retryProvisioningStageRequest: null,
    recheckProvisioningPermissionRequest: null,
    backToSetupRequest: null,
    continueInChatRequest: null,
    getClustersRequest: null,
    detectClusterAcrsRequest: null,
    useExistingClusterRequest: null,
    getCostEstimateRequest: null,
    runExistingReadinessRequest: null,
});
