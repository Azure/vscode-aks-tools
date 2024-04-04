import { WebviewDefinition } from "../../webviewTypes";
import { OpenFileOptions } from "../shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../shared/workspaceTypes";
import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    RepositoryKey,
    Subscription,
    SubscriptionKey,
    VsCodeCommand,
} from "./types";

export type InitialState = {
    workspaceConfig: WorkspaceFolderConfig;
    location: string;
    existingFiles: ExistingFiles;
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
    port: number;
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
    launchCommand: VsCodeCommand;
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
