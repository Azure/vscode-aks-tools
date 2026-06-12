import { Uri } from "vscode";
import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";
import { ReadyAzureSessionProvider } from "../auth/types";
import { failed, getErrorMessage } from "../commands/utils/errorable";
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
            errorNotification: null,
        });
    }
}

export class KickstartClusterDataProvider implements PanelDataProvider<"kickstartCluster"> {
    private scanToken: CancellationToken | undefined;
    private nextRunId = 0;
    private lastProvisioned: ProvisionedClusterInfo | null = null;
    private lastFinish: (() => Promise<void>) | null = null;

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
            runPreflightRequest: true,
            finishRequest: true,
            useExistingClusterRequest: true,
            retryProvisioningRequest: true,
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
            runPreflightRequest: (args) => this.handleRunPreflight(webview, args),
            finishRequest: (args) => this.handleFinish(webview, args),
            useExistingClusterRequest: (args) => this.handleUseExistingCluster(webview, args),
            retryProvisioningRequest: () => this.handleRetry(),
            continueInChatRequest: () => this.handleContinueInChat(),
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

    private async handleRunPreflight(
        webview: MessageSink<ToWebViewMsgDef>,
        args: { subscriptionId: string; location: string },
    ) {
        const token = new CancellationToken();
        const runId = this.nextRunId++;

        try {
            const result = await runPreflightChecks(
                this.sessionProvider,
                args.subscriptionId,
                args.location,
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
            );
            if (result.succeeded) {
                this.lastProvisioned = {
                    subscriptionName: selections.subscriptionName,
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

    private async handleContinueInChat() {
        if (this.lastProvisioned) {
            await handoffClusterToChat(this.lastProvisioned);
        }
    }
}
