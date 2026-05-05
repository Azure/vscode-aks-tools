import { l10n, Uri, commands, window } from "vscode";
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

export class KickstartPanel extends BasePanel<"kickstart"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "kickstart", {
            getSubscriptionsResponse: null,
            getResourceGroupsResponse: null,
            getClustersResponse: null,
            getAcrsResponse: null,
            getPermissionStatusResponse: null,
            attachAcrResponse: null,
            startKickstartResponse: null,
        });
    }
}

export class KickstartPanelDataProvider implements PanelDataProvider<"kickstart"> {
    constructor(
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly initialClusterId?: string,
    ) {}

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
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getSubscriptionsRequest: () => this.handleGetSubscriptionsRequest(webview),
            getResourceGroupsRequest: (args) => this.handleGetResourceGroupsRequest(args.subscriptionId, webview),
            getClustersRequest: (args) =>
                this.handleGetClustersRequest(args.subscriptionId, args.resourceGroup, webview),
            getAcrsRequest: (args) => this.handleGetAcrsRequest(args.subscriptionId, args.resourceGroup, webview),
            getPermissionStatusRequest: (args) =>
                this.handleGetPermissionStatusRequest(args.clusterKey, args.acrKey, webview),
            attachAcrRequest: (args) => this.handleAttachAcrRequest(args.clusterKey, args.acrKey, webview),
            startKickstartRequest: (args) => this.handleStartKickstartRequest(args.clusterKey, args.acrKey, webview),
        };
    }

    private async handleGetSubscriptionsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const azureSubscriptionsResult = await getSubscriptions(this.sessionProvider, SelectionType.AllIfNoFilters);
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
        const clustersResult = await getResources(this.sessionProvider, subscriptionId, clusterResourceType);
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
        const clustersResult = await getResources(this.sessionProvider, subscriptionId, clusterResourceType);
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
        const acrsResult = await getResources(this.sessionProvider, subscriptionId, acrResourceType);
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
        const result = await checkKickstartPermissions(this.sessionProvider, clusterKey, acrKey);
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
        const principalId = await getClusterPrincipalId(this.sessionProvider, clusterKey);
        if (failed(principalId)) {
            window.showErrorMessage(getErrorMessage(principalId));
            webview.postAttachAcrResponse({ succeeded: false, error: getErrorMessage(principalId) });
            return;
        }

        const client = getAuthorizationManagementClient(this.sessionProvider, acrKey.subscriptionId);
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
}
