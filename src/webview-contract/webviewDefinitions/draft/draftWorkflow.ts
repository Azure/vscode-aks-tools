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
    ResourceGroupKey,
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
    getResourceGroupsRequest: SubscriptionKey;
    getAcrsRequest: ResourceGroupKey;
    getRepositoriesRequest: AcrKey;
    getClustersRequest: ResourceGroupKey;
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
    getResourceGroupsResponse: SubscriptionKey & {
        groups: string[];
    };
    getAcrsResponse: ResourceGroupKey & {
        acrNames: string[];
    };
    getRepositoriesResponse: AcrKey & {
        repositoryNames: string[];
    };
    getClustersResponse: ResourceGroupKey & {
        clusterNames: string[];
    };
    getNamespacesResponse: ClusterKey & {
        namespaceNames: string[];
    };
    createWorkflowResponse: ExistingFile;
};

export type PickFilesIdentifier = "Dockerfile" | "BuildContext" | "Manifests" | "HelmCharts" | "HelmValuesYaml";

export type DraftWorkflowDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
