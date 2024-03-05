import { OpenFileOptions } from "../shared/fileSystemTypes";

export type LanguageInfo = {
    name: string;
    displayName: string;
    defaultPort: number;
    versions: LanguageVersionInfo[];
};

export type LanguageVersionInfo = {
    name: string;
    imageVersion: string;
    builderVersion: string;
};

export type ForkInfo = {
    name: string;
    url: string;
    owner: string;
    repo: string;
    isFork: boolean;
    defaultBranch: string;
};

export type Subscription = {
    id: string;
    name: string;
};

export const deploymentSpecTypes = ["helm", "kustomize", "manifests"] as const;
export type DeploymentSpecType = (typeof deploymentSpecTypes)[number];

export type SubscriptionKey = {
    subscriptionId: string;
};

export type ResourceGroupKey = SubscriptionKey & {
    resourceGroup: string;
};

export type AcrKey = ResourceGroupKey & {
    acrName: string;
};

export type RepositoryKey = AcrKey & {
    repositoryName: string;
};

export type ClusterKey = ResourceGroupKey & {
    clusterName: string;
};

export type ForkKey = {
    forkName: string;
};

export type NewOrExisting<T> = {
    isNew: boolean;
    value: T;
};

export type HelmDeploymentParams = {
    deploymentType: "helm";
    chartPath: string;
    valuesYamlPath: string;
    overrides: HelmOverride[];
};

export type HelmOverride = {
    key: string;
    value: string;
};

export type ManifestsDeploymentParams = {
    deploymentType: "manifests";
    manifestPaths: string[];
};

export type PickFilesRequestParams<TIdentifier> = {
    identifier: TIdentifier;
    options: OpenFileOptions;
};

export type PickFilesResponse<TIdentifier> = {
    identifier: TIdentifier;
    paths: [string, ...string[]];
};
