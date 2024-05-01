import { WebviewDefinition } from "../../webviewTypes";
import { OpenFileOptions } from "../shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import { AcrKey, ClusterKey, DeploymentSpecType, RepositoryKey, Subscription, SubscriptionKey } from "./types";

export type InitialState = {
    workspaceConfig: WorkspaceFolderConfig;
    location: string;
    existingFiles: ExistingFiles;
    initialSelection: InitialSelection;
};

export type InitialSelection = {
    targetPort?: number;
    subscriptionId?: string;
    clusterResourceGroup?: string;
    clusterName?: string;
};

export type ExistingFiles = {
    manifests: string[];
    kustomize: string[];
    helm: string[];
};

export type CreateParams = {
    subscriptionId: string;
    acrResourceGroup: string;
    location: string;
    deploymentSpecType: DeploymentSpecType;
    applicationName: string;
    targetPort: number;
    servicePort: number;
    namespace: string;
    acrName: string;
    repositoryName: string;
    tag: string;
};

export type ToVsCodeMsgDef = {
    pickLocationRequest: OpenFileOptions;
    getSubscriptionsRequest: void;
    getAcrsRequest: SubscriptionKey;
    getRepositoriesRequest: AcrKey;
    getRepoTagsRequest: RepositoryKey;
    getClustersRequest: SubscriptionKey;
    getNamespacesRequest: ClusterKey;
    createDeploymentRequest: CreateParams;
    openFileRequest: string;
    launchDraftWorkflow: LaunchDraftWorkflowParams;
};

export type LaunchDraftWorkflowParams = {
    initialSubscriptionId: string | null;
    initialAcrResourceGroup: string | null;
    initialAcrName: string | null;
    initialAcrRepository: string | null;
    initialClusterResourceGroup: string | null;
    initialClusterName: string | null;
    initialClusterNamespace: string | null;
    initialDeploymentSpecType: DeploymentSpecType;
    deploymentLocation: string;
};

export type ToWebViewMsgDef = {
    pickLocationResponse: {
        location: string;
        existingFiles: ExistingFiles;
    };
    getSubscriptionsResponse: Subscription[];
    getAcrsResponse: SubscriptionKey & {
        acrKeys: AcrKey[];
    };
    getRepositoriesResponse: AcrKey & {
        repositoryNames: string[];
    };
    getRepoTagsResponse: RepositoryKey & {
        tags: string[];
    };
    getClustersResponse: SubscriptionKey & {
        clusterKeys: ClusterKey[];
    };
    getNamespacesResponse: ClusterKey & {
        namespaceNames: string[];
    };
    createDeploymentResponse: ExistingFiles;
};

export type DraftDeploymentDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
