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
import { KickstartState, loadState, saveState } from "../chatParticipants/kickstart/state";
import { getReadySessionProvider } from "../auth/azureAuth";

export class KickstartPanel extends BasePanel<"kickstart"> {
    static currentPanel: KickstartPanel | undefined;
    static extensionUri: Uri | undefined;
    static currentState: KickstartState | undefined;
    static extensionContext: ExtensionContext | undefined;

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
        KickstartPanel.extensionContext = context;

        const sessionProvider = await getReadySessionProvider();
        const provider = failed(sessionProvider) ? undefined : sessionProvider.result;

        const panel = new KickstartPanel(KickstartPanel.extensionUri);
        const dataProvider = new KickstartPanelDataProvider(provider);
        panel.show(dataProvider);
        KickstartPanel.currentPanel = panel;
    }

    static pushState(state: KickstartState): void {
        KickstartPanel.currentState = state;
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

    static async triggerAcceptAll(): Promise<void> {
        const ctx = KickstartPanel.extensionContext;
        const workspaceFolders = workspace.workspaceFolders;
        if (!ctx || !workspaceFolders?.length) return;

        // Use in-memory state, or fall back to persisted state if the panel was never opened
        const workspaceFolder = workspaceFolders[0].uri.fsPath;
        const state = KickstartPanel.currentState ?? loadState(ctx, workspaceFolder);
        if (!state) return;

        const stagedFiles = state.artifacts?.stagedFiles ?? [];

        // Write each file to the workspace using VS Code's fs API (works on Desktop and Web)
        const workspaceRoot = workspaceFolders[0].uri;
        for (const f of stagedFiles) {
            if (f.status === "rejected") continue;
            const dest = Uri.joinPath(workspaceRoot, f.filename);
            await workspace.fs.writeFile(dest, Buffer.from(f.content, "utf8"));
        }

        const updated = stagedFiles.map((f) => (f.status !== "rejected" ? { ...f, status: "accepted" as const } : f));
        const newState: KickstartState = {
            ...state,
            artifacts: { stagedFiles: updated, savedToDisk: true },
        };
        KickstartPanel.currentState = newState;
        await saveState(ctx, workspaceFolder, newState);
        KickstartPanel.pushState(newState);
        const count = updated.filter((f) => f.status === "accepted").length;
        window.showInformationMessage(`Saved ${count} file(s) to project.`);
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
            acceptFileRequest: false,
            rejectFileRequest: false,
            acceptAllRequest: false,
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
            openArtifactRequest: (args) => this.handleOpenArtifactRequest(args.filename, args.stagedPath),
            acceptFileRequest: (args) => this.handleAcceptFileRequest(args.filename),
            rejectFileRequest: (args) => this.handleRejectFileRequest(args.filename),
            acceptAllRequest: () => this.handleAcceptAllRequest(),
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

    private async handleOpenArtifactRequest(_filename: string, stagedPath: string) {
        // stagedPath is a VS Code storage URI — works on Desktop and VS Code for the Web
        const uri = Uri.parse(stagedPath);
        const doc = await workspace.openTextDocument(uri);
        await window.showTextDocument(doc, { preview: true });
    }

    private async handleAcceptFileRequest(filename: string) {
        const ctx = KickstartPanel.extensionContext;
        const workspaceFolders = workspace.workspaceFolders;
        if (!KickstartPanel.currentState || !ctx || !workspaceFolders?.length) return;

        const stagedFiles = KickstartPanel.currentState.artifacts?.stagedFiles ?? [];
        const file = stagedFiles.find((f) => f.filename === filename);
        if (!file || file.status === "rejected") return;

        // Write the single file to the workspace
        const dest = Uri.joinPath(workspaceFolders[0].uri, file.filename);
        await workspace.fs.writeFile(dest, Buffer.from(file.content, "utf8"));

        const updated = stagedFiles.map((f) => (f.filename === filename ? { ...f, status: "accepted" as const } : f));
        const allSaved = updated.every((f) => f.status === "accepted" || f.status === "rejected");
        const newState: KickstartState = {
            ...KickstartPanel.currentState,
            artifacts: { stagedFiles: updated, savedToDisk: allSaved },
        };
        KickstartPanel.currentState = newState;
        await saveState(ctx, workspaceFolders[0].uri.fsPath, newState);
        KickstartPanel.pushState(newState);
        window.showInformationMessage(`Saved ${filename} to project.`);
    }

    private handleRejectFileRequest(filename: string) {
        if (!KickstartPanel.currentState) return;
        const stagedFiles = KickstartPanel.currentState.artifacts?.stagedFiles ?? [];
        const updated = stagedFiles.map((f) => (f.filename === filename ? { ...f, status: "rejected" as const } : f));
        KickstartPanel.currentState = {
            ...KickstartPanel.currentState,
            artifacts: { stagedFiles: updated, savedToDisk: false },
        };
        KickstartPanel.pushState(KickstartPanel.currentState);
    }

    private async handleAcceptAllRequest() {
        await KickstartPanel.triggerAcceptAll();
    }
}
