import { OpenFileOptions } from "../shared/fileSystemTypes";

export type LanguageInfo = {
    name: string;
    displayName: string;
    defaultPort?: number;
    exampleVersions: string[];
    versionDescription?: string;
    isBuilderImageRequired: boolean;
};

export type LanguageVersionInfo = {
    builderImageTag?: string;
    runtimeImageTag: string;
};

export type GitHubRepoKey = {
    gitHubRepoOwner: string;
    gitHubRepoName: string;
};

export type GitHubRepo = GitHubRepoKey & {
    forkName: string;
    url: string;
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

export function subscriptionKeysMatch(key1: SubscriptionKey, key2: SubscriptionKey): boolean {
    return key1.subscriptionId === key2.subscriptionId;
}

export function resourceGroupKeysMatch(key1: ResourceGroupKey, key2: ResourceGroupKey): boolean {
    return subscriptionKeysMatch(key1, key2) && key1.resourceGroup === key2.resourceGroup;
}

export function acrKeysMatch(key1: AcrKey, key2: AcrKey): boolean {
    return resourceGroupKeysMatch(key1, key2) && key1.acrName === key2.acrName;
}

export function repositoryKeysMatch(key1: RepositoryKey, key2: RepositoryKey): boolean {
    // Note: the use of 'key' here bears no relation to any secret or credential for a repository;
    // rather it refers to the set of properties that uniquely identify a repository (in this case
    // simply its name).
    return acrKeysMatch(key1, key2) && key1.repositoryName === key2.repositoryName;
}

export function clusterKeysMatch(key1: ClusterKey, key2: ClusterKey): boolean {
    return resourceGroupKeysMatch(key1, key2) && key1.clusterName === key2.clusterName;
}
