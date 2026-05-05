import { getWebviewMessageContext } from "../utilities/vscode";
import { Acr, Cluster, Subscription } from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import {
    Phase,
    AnalysisData,
    ConfigData,
    ArtifactsData,
    ImageData,
    DeploymentData,
    VerificationData,
    ErrorInfo,
    CommandLogEntry,
    ArmResource,
} from "../../../src/webview-contract/webviewDefinitions/kickstart";

export const vscode = getWebviewMessageContext<"kickstart">({
    getSubscriptionsRequest: null,
    getResourceGroupsRequest: null,
    getClustersRequest: null,
    getAcrsRequest: null,
    getPermissionStatusRequest: null,
    attachAcrRequest: null,
    startKickstartRequest: null,
    openArtifactRequest: null,
});

export type PermissionsState = {
    hasAcrPull?: boolean;
    attached?: boolean;
    loading: boolean;
    error?: string;
};

export type DashboardData = {
    currentPhase: Phase;
    analysis?: AnalysisData;
    config?: ConfigData;
    artifacts?: ArtifactsData;
    image?: ImageData;
    deployment?: DeploymentData;
    verification?: VerificationData;
    lastError?: ErrorInfo;
    auditLog?: CommandLogEntry[];
    armResources?: ArmResource[];
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

    // Dashboard state - populated when workflow starts
    dashboard?: DashboardData;
};
