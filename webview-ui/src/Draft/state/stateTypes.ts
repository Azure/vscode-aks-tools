import {
    AcrKey,
    ClusterKey,
    GitHubRepo,
    RepositoryKey,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { Lazy } from "../../utilities/lazy";

export type AzureReferenceData = {
    subscriptions: Lazy<SubscriptionReferenceData[]>;
};

export type SubscriptionReferenceData = {
    subscription: Subscription;
    acrs: Lazy<AcrReferenceData[]>;
    clusters: Lazy<ClusterReferenceData[]>;
};

export type AcrReferenceData = {
    key: AcrKey;
    repositories: Lazy<RepositoryReferenceData[]>;
};

export type RepositoryReferenceData = {
    key: RepositoryKey;
    tags: Lazy<string[]>;
};

export type ClusterReferenceData = {
    key: ClusterKey;
    namespaces: Lazy<string[]>;
};

export type GitHubReferenceData = {
    repositories: GitHubRepositoryReferenceData[];
};

export type GitHubRepositoryReferenceData = {
    repository: GitHubRepo;
    branches: Lazy<string[]>;
};
