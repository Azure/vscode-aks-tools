import { WebviewDefinition } from "../../webviewTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import {
    AcrKey,
    ClusterKey,
    ForkInfo,
    ForkKey,
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
    forks: ForkInfo[];
}

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
    getBranchesRequest: ForkKey;
    getSubscriptionsRequest: void;
    getAcrsRequest: SubscriptionKey;
    getRepositoriesRequest: AcrKey;
    getClustersRequest: SubscriptionKey;
    getNamespacesRequest: ClusterKey;
    createWorkflowRequest: CreateParams;
    openFileRequest: string;
};

export type ToWebViewMsgDef = {
    pickFilesResponse: PickFilesResponse<PickFilesIdentifier>;
    getBranchesResponse: ForkKey & {
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
    createWorkflowResponse: ExistingFile;
};

export type PickFilesIdentifier = "Dockerfile" | "BuildContext" | "Manifests" | "HelmCharts" | "HelmValuesYaml";

export type DraftWorkflowDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
