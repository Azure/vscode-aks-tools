import { l10n, Uri, commands, window, workspace, ExtensionContext } from "vscode";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAuthorizationManagementClient } from "../commands/utils/arm";
import { acrResourceType, clusterResourceType, getResources } from "../commands/utils/azureResources";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { getClusterPrincipalId } from "../commands/utils/identities";
import { checkKickstartPermissions } from "../commands/utils/kickstartPermissions";
import { createRoleAssignment, getScopeForAcr } from "../commands/utils/roleAssignments";
import { SelectionType, getSubscriptions } from "../commands/utils/subscriptions";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    AcrKey,
    ClusterKey,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kickstart";
import { Subscription, acrPullRoleDefinitionName } from "../webview-contract/webviewDefinitions/attachAcrToCluster";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { KickstartState } from "../chatParticipants/kickstart/state";
import { getReadySessionProvider } from "../auth/azureAuth";

export class KickstartPanel extends BasePanel<"kickstart"> {
    static currentPanel: KickstartPanel | undefined;
    static extensionUri: Uri | undefined;

    constructor(extensionUri: Uri) {
        super(extensionUri, "kickstart", {
            getSubscriptionsResponse: null,
            getResourceGroupsResponse: null,
            getClustersResponse: null,
            getAcrsResponse: null,
            getPermissionStatusResponse: null,
            attachAcrResponse: null,
            startKickstartResponse: null,
            stateChanged: null,
        });
    }

    static async showIfNotOpen(context: ExtensionContext): Promise<void> {
        if (KickstartPanel.currentPanel?.currentWebview) {
            return;
        }

        if (!KickstartPanel.extensionUri) {
            KickstartPanel.extensionUri = context.extensionUri;
        }

        const sessionProvider = await getReadySessionProvider();
        const provider = failed(sessionProvider) ? undefined : sessionProvider.result;

        const panel = new KickstartPanel(KickstartPanel.extensionUri);
        const dataProvider = new KickstartPanelDataProvider(provider);
        panel.show(dataProvider);
        KickstartPanel.currentPanel = panel;
    }

    static pushState(state: KickstartState): void {
        if (KickstartPanel.currentPanel && KickstartPanel.currentPanel.currentWebview) {
            KickstartPanel.currentPanel.currentWebview.postStateChanged({
                currentPhase: state.currentPhase,
                analysis: state.analysis,
                config: state.config,
                artifacts: state.artifacts,
                image: state.image,
                deployment: state.deployment,
                verification: state.verification,
                lastError: state.lastError,
                auditLog: state.auditLog,
                armResources: state.armResources,
            });
        }
    }
}

export class KickstartPanelDataProvider implements PanelDataProvider<"kickstart"> {
    readonly sessionProvider: ReadyAzureSessionProvider | undefined;
    readonly initialClusterId: string | undefined;

    constructor(sessionProvider?: ReadyAzureSessionProvider, initialClusterId?: string) {
        this.sessionProvider = sessionProvider;
        this.initialClusterId = initialClusterId;
    }

    private requireAuth(): ReadyAzureSessionProvider {
        if (!this.sessionProvider) {
            throw new Error("Azure authentication required");
        }
        return this.sessionProvider;
    }

    getTitle(): string {
        return l10n.t("Kickstart Containerization");
    }

    getInitialState(): InitialState {
        return { initialClusterId: this.initialClusterId };
    }

    getTelemetryDefinition(): TelemetryDefinition<"kickstart"> {
        return {
            getSubscriptionsRequest: false,
            getResourceGroupsRequest: false,
            getClustersRequest: false,
            getAcrsRequest: false,
            getPermissionStatusRequest: false,
            attachAcrRequest: false,
            startKickstartRequest: false,
            openArtifactRequest: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getSubscriptionsRequest: () => {
                if (this.sessionProvider) this.handleGetSubscriptionsRequest(webview);
            },
            getResourceGroupsRequest: (args) => {
                if (this.sessionProvider) this.handleGetResourceGroupsRequest(args.subscriptionId, webview);
            },
            getClustersRequest: (args) => {
                if (this.sessionProvider) {
                    this.handleGetClustersRequest(args.subscriptionId, args.resourceGroup, webview);
                }
            },
            getAcrsRequest: (args) => {
                if (this.sessionProvider) this.handleGetAcrsRequest(args.subscriptionId, args.resourceGroup, webview);
            },
            getPermissionStatusRequest: (args) => {
                if (this.sessionProvider) {
                    this.handleGetPermissionStatusRequest(args.clusterKey, args.acrKey, webview);
                }
            },
            attachAcrRequest: (args) => {
                if (this.sessionProvider) this.handleAttachAcrRequest(args.clusterKey, args.acrKey, webview);
            },
            startKickstartRequest: (args) => {
                if (this.sessionProvider) this.handleStartKickstartRequest(args.clusterKey, args.acrKey, webview);
            },
            openArtifactRequest: (args) => this.handleOpenArtifactRequest(args.filename, args.content),
        };
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptionsResult = await getSubscriptions(this.requireAuth(), SelectionType.AllIfNoFilters);
        if (failed(azureSubscriptionsResult)) {
            window.showErrorMessage(azureSubscriptionsResult.error);
            webview.postGetSubscriptionsResponse({ subscriptions: [] });
            return;
        }

        const subscriptions: Subscription[] = azureSubscriptionsResult.result.map((subscription) => ({
            subscriptionId: subscription.subscriptionId,
            name: subscription.displayName,
        }));

        webview.postGetSubscriptionsResponse({ subscriptions });
    }

    private async handleGetResourceGroupsRequest(subscriptionId: string, webview: MessageSink<ToWebViewMsgDef>) {
        const clustersResult = await getResources(this.requireAuth(), subscriptionId, clusterResourceType);
        if (failed(clustersResult)) {
            window.showErrorMessage(clustersResult.error);
            webview.postGetResourceGroupsResponse({ subscriptionId, resourceGroups: [] });
            return;
        }

        const resourceGroups = [...new Set(clustersResult.result.map((c) => c.resourceGroup))].sort((a, b) =>
            a.localeCompare(b),
        );

        webview.postGetResourceGroupsResponse({ subscriptionId, resourceGroups });
    }

    private async handleGetClustersRequest(
        subscriptionId: string,
        resourceGroup: string | undefined,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const key = { subscriptionId };
        const clustersResult = await getResources(this.requireAuth(), subscriptionId, clusterResourceType);
        if (failed(clustersResult)) {
            window.showErrorMessage(clustersResult.error);
            webview.postGetClustersResponse({ key, clusters: [] });
            return;
        }

        const clusters: ClusterKey[] = clustersResult.result
            .filter((c) => !resourceGroup || c.resourceGroup === resourceGroup)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => ({
                subscriptionId,
                resourceGroup: c.resourceGroup,
                clusterName: c.name,
            }));

        webview.postGetClustersResponse({ key, clusters });
    }

    private async handleGetAcrsRequest(
        subscriptionId: string,
        resourceGroup: string | undefined,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const key = { subscriptionId };
        const acrsResult = await getResources(this.requireAuth(), subscriptionId, acrResourceType);
        if (failed(acrsResult)) {
            window.showErrorMessage(acrsResult.error);
            webview.postGetAcrsResponse({ key, acrs: [] });
            return;
        }

        const acrs: AcrKey[] = acrsResult.result
            .filter((a) => !resourceGroup || a.resourceGroup === resourceGroup)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => ({
                subscriptionId,
                resourceGroup: a.resourceGroup,
                acrName: a.name,
            }));

        webview.postGetAcrsResponse({ key, acrs });
    }

    private async handleGetPermissionStatusRequest(
        clusterKey: ClusterKey,
        acrKey: AcrKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const result = await checkKickstartPermissions(this.requireAuth(), clusterKey, acrKey);
        if (failed(result)) {
            window.showErrorMessage(getErrorMessage(result));
            webview.postGetPermissionStatusResponse({
                hasAcrPull: false,
                attached: false,
                error: getErrorMessage(result),
            });
            return;
        }

        webview.postGetPermissionStatusResponse({
            hasAcrPull: result.result.hasAcrPull,
            attached: result.result.attached,
        });
    }

    private async handleAttachAcrRequest(
        clusterKey: ClusterKey,
        acrKey: AcrKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const principalId = await getClusterPrincipalId(this.requireAuth(), clusterKey);
        if (failed(principalId)) {
            window.showErrorMessage(getErrorMessage(principalId));
            webview.postAttachAcrResponse({ succeeded: false, error: getErrorMessage(principalId) });
            return;
        }

        const client = getAuthorizationManagementClient(this.requireAuth(), acrKey.subscriptionId);
        const scope = getScopeForAcr(acrKey.subscriptionId, acrKey.resourceGroup, acrKey.acrName);

        const roleAssignment = await createRoleAssignment(
            client,
            acrKey.subscriptionId,
            principalId.result,
            acrPullRoleDefinitionName,
            scope,
            "ServicePrincipal",
        );

        if (failed(roleAssignment)) {
            window.showErrorMessage(roleAssignment.error);
            webview.postAttachAcrResponse({ succeeded: false, error: roleAssignment.error });
            return;
        }

        webview.postAttachAcrResponse({ succeeded: true });
    }

    private async handleStartKickstartRequest(
        _clusterKey: ClusterKey,
        _acrKey: AcrKey,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        await commands.executeCommand("workbench.action.chat.open", { query: "@kickstart /start" });
        webview.postStartKickstartResponse(undefined);
    }

    private async handleOpenArtifactRequest(filename: string, content: string) {
        const doc = await workspace.openTextDocument({ content, language: this.getLanguageId(filename) });
        await window.showTextDocument(doc, { preview: true });
    }

    private getLanguageId(filename: string): string {
        if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
            return "yaml";
        }
        if (filename === "Dockerfile") {
            return "dockerfile";
        }
        return "plaintext";
    }
}
