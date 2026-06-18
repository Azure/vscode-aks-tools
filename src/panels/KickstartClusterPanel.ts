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
import { attachRegistryToExistingCluster, runClusterProvisioning } from "./kickstartProvision";

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

export class KickstartClusterDataProvider implements PanelDataProvider<"kickstartCluster"> {
    private scanToken: CancellationToken | undefined;
    private nextRunId = 0;
    private lastProvisioned: ProvisionedClusterInfo | null = null;
    private lastFinish: (() => Promise<void>) | null = null;
    private readonly provisioningGate = new ProvisioningAccessGate();

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
            recheckProvisioningPermissionRequest: false,
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
            recheckProvisioningPermissionRequest: (args) => this.handleRecheckProvisioningPermission(args.runId),
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
        const token = new CancellationToken();
        const runId = this.nextRunId++;

        try {
            const result = await runClusterProvisioning(
                this.sessionProvider,
                selections,
                runId,
                webview,
                getKickstartOutputChannel(),
                token,
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
            if (result.succeeded) {
                this.lastProvisioned = {
                    subscriptionName: selections.subscriptionName,
                    subscriptionId: selections.subscriptionId,
                    resourceGroupName: selections.resourceGroupName,
                    clusterName: result.clusterName,
                    clusterPortalUrl: result.clusterPortalUrl,
                    acrName: result.acrName,
                    acrLoginServer: result.acrLoginServer,
                };
            }
            webview.postFinishComplete(result);
        } catch (e) {
            webview.postErrorNotification({ message: getErrorMessage(e) });
        }
    }

    private async handleRetry() {
        if (this.lastFinish) {
            await this.lastFinish();
        }
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
        const token = new CancellationToken();
        const runId = this.nextRunId++;

        try {
            const result = await attachRegistryToExistingCluster(
                this.sessionProvider,
                selection,
                runId,
                webview,
                getKickstartOutputChannel(),
                token,
            );
            if (result.succeeded) {
                this.lastProvisioned = {
                    subscriptionName: selection.subscriptionName,
                    subscriptionId: selection.subscriptionId,
                    resourceGroupName: selection.clusterResourceGroup,
                    clusterName: result.clusterName,
                    clusterPortalUrl: result.clusterPortalUrl,
                    acrName: result.acrName,
                    acrLoginServer: result.acrLoginServer,
                };
            }
            webview.postFinishComplete(result);
        } catch (e) {
            webview.postErrorNotification({ message: getErrorMessage(e) });
        }
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
