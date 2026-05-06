import { WebviewDefinition } from "../webviewTypes";
import { AcrKey, Cluster, ClusterKey, Subscription, SubscriptionKey, Acr } from "./attachAcrToCluster";

export type { AcrKey, ClusterKey, SubscriptionKey };

export interface InitialState {
    initialClusterId?: string;
}

export enum Phase {
    ANALYZE = 0,
    CONFIGURE = 1,
    PREPARE = 2,
    BUILD = 3,
    DEPLOY = 4,
    VERIFY = 5,
    COMPLETE = 6,
}

export interface CommandLogEntry {
    command: string;
    timestamp: number;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    phase: Phase;
    durationMs?: number;
}

export interface ArmResource {
    type: string;
    name: string;
    resourceGroup: string;
    action: "used" | "created" | "modified";
}

export interface AnalysisData {
    language: string;
    framework?: string;
    ports: number[];
    entryPoint?: string;
    isMonorepo: boolean;
    hasDockerfile: boolean;
    hasK8sManifests: boolean;
    hasGitHubWorkflow: boolean;
}

export interface ConfigData {
    subscriptionId: string;
    resourceGroup: string;
    clusterName: string;
    clusterSku: "Automatic" | "Standard";
    acrName: string;
    acrLoginServer: string;
    canGetKubeconfig: boolean;
    hasAcrPull: boolean;
}

export interface Manifest {
    filename: string;
    content: string;
}

export interface ArtifactsData {
    dockerfile?: string;
    manifests?: Manifest[];
    workflowYaml?: string;
    savedToDisk: boolean;
}

export interface ImageData {
    repository: string;
    tag: string;
}

export interface DeploymentData {
    appliedManifests: string[];
    timestamp: number;
}

export interface VerificationData {
    podsReady: boolean;
    serviceEndpoint?: string;
}

export interface ErrorInfo {
    phase: Phase;
    message: string;
    retryable: boolean;
}

export type ToVsCodeMsgDef = {
    getSubscriptionsRequest: void;
    getResourceGroupsRequest: { subscriptionId: string };
    getClustersRequest: { subscriptionId: string; resourceGroup?: string };
    getAcrsRequest: { subscriptionId: string; resourceGroup?: string };
    getPermissionStatusRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
    attachAcrRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
    startKickstartRequest: { clusterKey: ClusterKey; acrKey: AcrKey };
    openArtifactRequest: { filename: string; content: string };
};

export type ToWebViewMsgDef = {
    getSubscriptionsResponse: { subscriptions: Subscription[] };
    getResourceGroupsResponse: { subscriptionId: string; resourceGroups: string[] };
    getClustersResponse: { key: SubscriptionKey; clusters: Cluster[] };
    getAcrsResponse: { key: SubscriptionKey; acrs: Acr[] };
    getPermissionStatusResponse: { hasAcrPull: boolean; attached: boolean; loading?: boolean; error?: string };
    attachAcrResponse: { succeeded: boolean; error?: string };
    startKickstartResponse: void;
    stateChanged: {
        currentPhase: number;
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
};

export type KickstartDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
