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

export enum VsCodeCommand {
    DraftDeployment,
    DraftWorkflow,
}

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
    return acrKeysMatch(key1, key2) && key1.repositoryName === key2.repositoryName;
}

export function clusterKeysMatch(key1: ClusterKey, key2: ClusterKey): boolean {
    return resourceGroupKeysMatch(key1, key2) && key1.clusterName === key2.clusterName;
}
