import { getWebviewMessageContext } from "../utilities/vscode";
import { Acr, Cluster, Subscription } from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";

export const vscode = getWebviewMessageContext<"kickstart">({
    getSubscriptionsRequest: null,
    getResourceGroupsRequest: null,
    getClustersRequest: null,
    getAcrsRequest: null,
    getPermissionStatusRequest: null,
    attachAcrRequest: null,
    startKickstartRequest: null,
});

export type PermissionsState = {
    hasAcrPull?: boolean;
    attached?: boolean;
    loading: boolean;
    error?: string;
};

export type KickstartState = {
    subscriptions: Subscription[];
    selectedSub: Subscription | null;

    resourceGroups: string[];
    selectedRg: string | null;

    clusters: Cluster[];
    selectedCluster: Cluster | null;

    acrs: Acr[];
    selectedAcr: Acr | null;

    permissions: PermissionsState;
};
