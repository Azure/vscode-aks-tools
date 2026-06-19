import { Uri } from "vscode";
import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ReadyAzureSessionProvider } from "../auth/types";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { estimateClusterMonthlyCost } from "../commands/utils/kickstartCostEstimate";
import {
    LAST_SUBSCRIPTION_KEY,
    ProvisionedClusterInfo,
    handoffClusterToChat,
} from "../commands/aksKickstart/kickstartChat";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    ClusterLaunchContext,
    ClusterSelections,
    ExistingClusterSelection,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kickstartCluster";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { CancellationToken, ScanCancelledError, getKickstartOutputChannel } from "./kickstartActivity";
import {
    getClusterList,
    getConnectedAcrList,
    getExistingClusterReadiness,
    getLocationList,
    getResourceGroupList,
    getSubscriptionList,
    runPreflightChecks,
    runSubscriptionScan,
} from "./kickstartAzureBackend";
import {
    ClusterProvisioningResult,
    ProvisioningRun,
    createClusterProvisioningRun,
    createExistingClusterAttachRun,
} from "./kickstartProvision";

export class KickstartClusterPanel extends BasePanel<"kickstartCluster"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kickstartCluster", {
            getSubscriptionsResponse: null,
            getLocationsResponse: null,
            getResourceGroupsResponse: null,
            getClustersResponse: null,
            detectClusterAcrsResponse: null,
            activitySnapshot: null,
            subscriptionScanComplete: null,
            preflightComplete: null,
            finishComplete: null,
            getCostEstimateResponse: null,
            existingReadinessComplete: null,
            awaitingProvisioningAccess: null,
            provisioningAccessResolved: null,
            errorNotification: null,
        });
    }
}

type ProvisioningAccessProbe = () => Promise<boolean>;

interface ProvisioningAccessRequest {
    runId: number;
    probe: ProvisioningAccessProbe;
    onResolved: () => void;
    onStillBlocked: () => void;
    settle: (granted: boolean) => void;
    rechecking: boolean;
}

class ProvisioningAccessGate {
    private active: ProvisioningAccessRequest | null = null;

    waitForAccess(
        runId: number,
        probe: ProvisioningAccessProbe,
        onResolved: () => void,
        onStillBlocked: () => void,
    ): Promise<boolean> {
        this.cancel();
        return new Promise<boolean>((resolve) => {
            this.active = { runId, probe, onResolved, onStillBlocked, settle: resolve, rechecking: false };
        });
    }

    async recheck(runId: number): Promise<void> {
        const request = this.active;
        if (!request || request.runId !== runId || request.rechecking) {
            return;
        }
        request.rechecking = true;
        try {
            const granted = await request.probe();
            if (this.active !== request) {
                return;
            }
            if (granted) {
                this.active = null;
                request.onResolved();
                request.settle(true);
            } else {
                request.onStillBlocked();
            }
        } finally {
            if (this.active === request) {
                request.rechecking = false;
            }
        }
    }

    cancel(): void {
        const request = this.active;
        if (!request) {
            return;
        }
        this.active = null;
        request.settle(false);
    }
}

interface ActiveProvisioningRun {
    run: ProvisioningRun;
    webview: MessageSink<ToWebViewMsgDef>;
    toProvisioned: (result: ClusterProvisioningResult) => ProvisionedClusterInfo;
}

export class KickstartClusterDataProvider implements PanelDataProvider<"kickstartCluster"> {
    private scanToken: CancellationToken | undefined;
    private nextRunId = 0;
    private lastProvisioned: ProvisionedClusterInfo | null = null;
    private lastFinish: (() => Promise<void>) | null = null;
    private readonly provisioningGate = new ProvisioningAccessGate();
    private activeRun: ActiveProvisioningRun | null = null;
    private provisioningInFlight: Promise<void> | null = null;
    private activeProvisioningToken: CancellationToken | undefined;
    private runGeneration = 0;

    constructor(
        private readonly sessionProvider: ReadyAzureSessionProvider,
        private readonly context: vscode.ExtensionContext,
        private readonly launchContext: ClusterLaunchContext,
    ) {}

    getTitle(): string {
        return l10n.t("AKS Kickstart — Configure Cluster");
    }

    getInitialState(): InitialState {
        return {
            launchContext: this.launchContext,
            lastSubscriptionId: this.context.globalState.get<string>(LAST_SUBSCRIPTION_KEY) ?? null,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"kickstartCluster"> {
        return {
            getSubscriptionsRequest: false,
            getLocationsRequest: false,
            getResourceGroupsRequest: false,
            getClustersRequest: false,
            detectClusterAcrsRequest: false,
            startSubscriptionScanRequest: false,
            cancelSubscriptionScanRequest: false,
            getCostEstimateRequest: false,
            runExistingReadinessRequest: false,
            runPreflightRequest: true,
            finishRequest: true,
            useExistingClusterRequest: true,
            retryProvisioningRequest: true,
            retryProvisioningStageRequest: true,
            recheckProvisioningPermissionRequest: false,
            backToSetupRequest: true,
            continueInChatRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getSubscriptionsRequest: () => this.handleGetSubscriptions(webview),
            getLocationsRequest: (args) => this.handleGetLocations(webview, args.subscriptionId),
            getResourceGroupsRequest: (args) => this.handleGetResourceGroups(webview, args.subscriptionId),
            getClustersRequest: (args) => this.handleGetClusters(webview, args.subscriptionId),
            detectClusterAcrsRequest: (args) => this.handleDetectClusterAcrs(webview, args),
            startSubscriptionScanRequest: (args) => this.handleStartSubscriptionScan(webview, args.subscriptionId),
            cancelSubscriptionScanRequest: () => this.scanToken?.cancel(),
            getCostEstimateRequest: (args) => this.handleGetCostEstimate(webview, args.location),
            runPreflightRequest: (args) => this.handleRunPreflight(webview, args),
            finishRequest: (args) => this.handleFinish(webview, args),
            useExistingClusterRequest: (args) => this.handleUseExistingCluster(webview, args),
            retryProvisioningRequest: () => this.handleRetry(),
            retryProvisioningStageRequest: (args) => this.handleRetryStage(args),
            recheckProvisioningPermissionRequest: (args) => this.handleRecheckProvisioningPermission(args.runId),
            backToSetupRequest: () => this.handleBackToSetup(),
            continueInChatRequest: () => this.handleContinueInChat(),
            runExistingReadinessRequest: (args) => this.handleRunExistingReadiness(webview, args),
        };
    }

    private async handleGetSubscriptions(webview: MessageSink<ToWebViewMsgDef>) {
        const lastSubscriptionId = this.context.globalState.get<string>(LAST_SUBSCRIPTION_KEY);
        const result = await getSubscriptionList(this.sessionProvider, lastSubscriptionId);
        if (failed(result)) {
            webview.postErrorNotification({ message: result.error });
            return;
        }

        webview.postGetSubscriptionsResponse(result.result);
    }

    private async handleGetLocations(webview: MessageSink<ToWebViewMsgDef>, subscriptionId: string) {
        const result = await getLocationList(this.sessionProvider, subscriptionId);
        if (failed(result)) {
            webview.postErrorNotification({ message: result.error });
            return;
        }

        webview.postGetLocationsResponse({ locations: result.result });
    }

    private async handleGetResourceGroups(webview: MessageSink<ToWebViewMsgDef>, subscriptionId: string) {
        const result = await getResourceGroupList(this.sessionProvider, subscriptionId);
        if (failed(result)) {
            webview.postErrorNotification({ message: result.error });
            return;
        }

        webview.postGetResourceGroupsResponse({ groups: result.result });
    }

    private async handleStartSubscriptionScan(webview: MessageSink<ToWebViewMsgDef>, subscriptionId: string) {
        this.scanToken?.cancel();
        const token = new CancellationToken();
        this.scanToken = token;
        const runId = this.nextRunId++;

        try {
            const result = await runSubscriptionScan(
                this.sessionProvider,
                subscriptionId,
                runId,
                webview,
                getKickstartOutputChannel(),
                token,
            );
            webview.postSubscriptionScanComplete(result);
        } catch (e) {
            if (token.isCancelled || e instanceof ScanCancelledError) {
                return;
            }
            webview.postErrorNotification({ message: getErrorMessage(e) });
        }
    }

    private async handleGetCostEstimate(webview: MessageSink<ToWebViewMsgDef>, location: string) {
        const result = await estimateClusterMonthlyCost(location);
        if (failed(result)) {
            webview.postGetCostEstimateResponse({ location, estimate: null, error: result.error });
            return;
        }

        webview.postGetCostEstimateResponse({ location, estimate: result.result, error: null });
    }

    private async handleRunPreflight(
        webview: MessageSink<ToWebViewMsgDef>,
        args: { subscriptionId: string; location: string; resourceGroupName: string; isNewResourceGroup: boolean },
    ) {
        const token = new CancellationToken();
        const runId = this.nextRunId++;

        try {
            const result = await runPreflightChecks(
                this.sessionProvider,
                args.subscriptionId,
                args.location,
                { name: args.resourceGroupName, isNew: args.isNewResourceGroup },
                runId,
                webview,
                getKickstartOutputChannel(),
                token,
            );
            webview.postPreflightComplete(result);
        } catch (e) {
            webview.postErrorNotification({ message: getErrorMessage(e) });
        }
    }

    private async handleFinish(webview: MessageSink<ToWebViewMsgDef>, selections: ClusterSelections) {
        this.lastFinish = () => this.handleFinish(webview, selections);
        await this.context.globalState.update(LAST_SUBSCRIPTION_KEY, selections.subscriptionId);
        const runId = this.nextRunId++;
        const run = createClusterProvisioningRun(
            this.sessionProvider,
            selections,
            runId,
            webview,
            getKickstartOutputChannel(),
            (prompt, probe) => {
                webview.postAwaitingProvisioningAccess(prompt);
                return this.provisioningGate.waitForAccess(
                    prompt.runId,
                    probe,
                    () => webview.postProvisioningAccessResolved({ runId: prompt.runId }),
                    () => webview.postAwaitingProvisioningAccess(prompt),
                );
            },
        );
        await this.startProvisioningRun(webview, run, (result) => ({
            subscriptionName: selections.subscriptionName,
            subscriptionId: selections.subscriptionId,
            resourceGroupName: selections.resourceGroupName,
            clusterName: result.clusterName,
            clusterPortalUrl: result.clusterPortalUrl,
            acrName: result.acrName,
            acrLoginServer: result.acrLoginServer,
        }));
    }

    private async handleRetry() {
        if (this.lastFinish) {
            await this.lastFinish();
        }
    }

    private async startProvisioningRun(
        webview: MessageSink<ToWebViewMsgDef>,
        run: ProvisioningRun,
        toProvisioned: (result: ClusterProvisioningResult) => ProvisionedClusterInfo,
    ) {
        this.activeRun = { run, webview, toProvisioned };
        await this.runProvisioningAttempt(undefined);
    }

    private async runProvisioningAttempt(startStageId: string | undefined) {
        const active = this.activeRun;
        if (!active) {
            return;
        }

        // Supersede any attempt still in flight (e.g. a retry click during provisioning) before
        // starting a new one against the same run so their snapshots don't interleave.
        if (this.provisioningInFlight) {
            this.activeProvisioningToken?.cancel();
            this.provisioningGate.cancel();
            await this.provisioningInFlight;
        }

        const token = new CancellationToken();
        const generation = ++this.runGeneration;
        this.activeProvisioningToken = token;

        const attempt = (async () => {
            try {
                const result = await active.run.runFrom(startStageId, token);
                // A newer attempt superseded this one while it was running; drop its result.
                if (generation !== this.runGeneration) {
                    return;
                }
                if (result.succeeded) {
                    this.lastProvisioned = active.toProvisioned(result);
                }
                active.webview.postFinishComplete(result);
            } catch (e) {
                if (token.isCancelled || generation !== this.runGeneration) {
                    return;
                }
                active.webview.postErrorNotification({ message: getErrorMessage(e) });
            }
        })();

        this.provisioningInFlight = attempt;
        try {
            await attempt;
        } finally {
            if (this.provisioningInFlight === attempt) {
                this.provisioningInFlight = null;
                this.activeProvisioningToken = undefined;
            }
        }
    }

    private async handleRetryStage(args: { runId: number; stageId: string }) {
        const active = this.activeRun;
        // Fall back to a whole-run restart if the stage belongs to a superseded run (e.g. after reload).
        if (!active || active.run.runId !== args.runId || !active.run.stageIds.includes(args.stageId)) {
            await this.handleRetry();
            return;
        }
        await this.runProvisioningAttempt(args.stageId);
    }

    private handleBackToSetup() {
        // Abandon any in-flight attempt without awaiting teardown: the ARM deployment poll ignores
        // our cancellation token, so bumping the generation drops the stale attempt's eventual result
        // and lets the user reconfigure immediately instead of blocking on a long-running deployment.
        this.activeProvisioningToken?.cancel();
        this.provisioningGate.cancel();
        this.runGeneration++;
        this.activeRun = null;
        this.activeProvisioningToken = undefined;
        this.provisioningInFlight = null;
    }

    private handleRecheckProvisioningPermission(runId: number) {
        void this.provisioningGate.recheck(runId);
    }

    private async handleGetClusters(webview: MessageSink<ToWebViewMsgDef>, subscriptionId: string) {
        const result = await getClusterList(this.sessionProvider, subscriptionId);
        if (failed(result)) {
            webview.postErrorNotification({ message: result.error });
            return;
        }

        webview.postGetClustersResponse({ subscriptionId, clusters: result.result });
    }

    private async handleDetectClusterAcrs(
        webview: MessageSink<ToWebViewMsgDef>,
        args: { subscriptionId: string; clusterResourceGroup: string; clusterName: string },
    ) {
        const result = await getConnectedAcrList(
            this.sessionProvider,
            args.subscriptionId,
            args.clusterResourceGroup,
            args.clusterName,
        );
        if (failed(result)) {
            webview.postErrorNotification({ message: result.error });
            return;
        }

        webview.postDetectClusterAcrsResponse({
            subscriptionId: args.subscriptionId,
            clusterResourceGroup: args.clusterResourceGroup,
            clusterName: args.clusterName,
            acrs: result.result,
        });
    }

    private async handleUseExistingCluster(webview: MessageSink<ToWebViewMsgDef>, selection: ExistingClusterSelection) {
        this.lastFinish = () => this.handleUseExistingCluster(webview, selection);
        await this.context.globalState.update(LAST_SUBSCRIPTION_KEY, selection.subscriptionId);
        const runId = this.nextRunId++;
        const run = createExistingClusterAttachRun(
            this.sessionProvider,
            selection,
            runId,
            webview,
            getKickstartOutputChannel(),
        );
        await this.startProvisioningRun(webview, run, (result) => ({
            subscriptionName: selection.subscriptionName,
            subscriptionId: selection.subscriptionId,
            resourceGroupName: selection.clusterResourceGroup,
            clusterName: result.clusterName,
            clusterPortalUrl: result.clusterPortalUrl,
            acrName: result.acrName,
            acrLoginServer: result.acrLoginServer,
        }));
    }

    private async handleRunExistingReadiness(
        webview: MessageSink<ToWebViewMsgDef>,
        args: {
            subscriptionId: string;
            clusterResourceGroup: string;
            clusterName: string;
            acrName?: string;
            acrResourceGroup?: string;
            requestKey: string;
        },
    ) {
        const readiness = await getExistingClusterReadiness(
            args.subscriptionId,
            args.clusterResourceGroup,
            args.clusterName,
            args.acrName,
            args.acrResourceGroup,
        );
        webview.postExistingReadinessComplete({ readiness, requestKey: args.requestKey });
    }

    private async handleContinueInChat() {
        if (this.lastProvisioned) {
            await handoffClusterToChat(this.lastProvisioned);
        }
    }
}
