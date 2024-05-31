import { WebviewDefinition } from "../../webviewTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    GitHubRepo,
    GitHubRepoKey,
    HelmDeploymentParams,
    ManifestsDeploymentParams,
    PickFilesRequestParams,
    PickFilesResponse,
    Subscription,
    SubscriptionKey,
} from "./types";

export interface InitialState {
    workspaceConfig: WorkspaceFolderConfig;
    existingWorkflowFiles: ExistingFile[];
    repos: GitHubRepo[];
    initialSelection: InitialSelection;
}

export type InitialSelection = {
    dockerfilePath?: string;
    dockerfileBuildContextPath?: string;
    subscriptionId?: string;
    acrResourceGroup?: string;
    acrName?: string;
    acrRepository?: string;
    clusterResourceGroup?: string;
    clusterName?: string;
    clusterNamespace?: string;
    deploymentSpecType?: DeploymentSpecType;
    helmChartPath?: string;
    helmValuesYamlPath?: string;
    manifestFilePaths?: string[];
};

export type ExistingFile = {
    name: string;
    path: string;
};

export type CreateParams = {
    workflowName: string;
    branchName: string;
    subscriptionId: string;
    dockerfilePath: string;
    buildContextPath: string;
    acrResourceGroup: string;
    acrName: string;
    repositoryName: string;
    clusterResourceGroup: string;
    clusterName: string;
    namespace: string;
    deploymentParams: ManifestsDeploymentParams | HelmDeploymentParams;
};

export type ToVsCodeMsgDef = {
    pickFilesRequest: PickFilesRequestParams<PickFilesIdentifier>;
    getBranchesRequest: GitHubRepoKey;
    getSubscriptionsRequest: void;
    getAcrsRequest: SubscriptionKey;
    getRepositoriesRequest: AcrKey;
    getClustersRequest: SubscriptionKey;
    getNamespacesRequest: ClusterKey;
    createWorkflowRequest: CreateParams;
    openFileRequest: string;
    launchDraftDockerfile: void;
    launchDraftDeployment: void;
    launchConnectAcrToCluster: LaunchConnectAcrToClusterParams;
};

export type LaunchConnectAcrToClusterParams = {
    initialSubscriptionId: string | null;
    initialAcrResourceGroup: string | null;
    initialAcrName: string | null;
    initialClusterResourceGroup: string | null;
    initialClusterName: string | null;
};

export type ToWebViewMsgDef = {
    pickFilesResponse: PickFilesResponse<PickFilesIdentifier>;
    getBranchesResponse: GitHubRepoKey & {
        branches: string[];
    };
    getSubscriptionsResponse: Subscription[];
    getAcrsResponse: SubscriptionKey & {
        acrKeys: AcrKey[];
    };
    getRepositoriesResponse: AcrKey & {
        repositoryNames: string[];
    };
    getClustersResponse: SubscriptionKey & {
        clusterKeys: ClusterKey[];
    };
    getNamespacesResponse: ClusterKey & {
        namespaceNames: string[];
    };
    createWorkflowResponse: ExistingFile[];
};

export type PickFilesIdentifier = "Dockerfile" | "BuildContext" | "Manifests" | "HelmCharts" | "HelmValuesYaml";

export type DraftWorkflowDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
