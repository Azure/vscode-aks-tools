import { Subscription } from "../../../../../src/webview-contract/webviewDefinitions/draft/types";

export type SubscriptionData = {
    subscription: Subscription;
    resourceGroups: ResourceGroupData[];
};

export type ResourceGroupData = {
    group: string;
    clusters: ClusterData[];
    acrs: AcrData[];
};

export type ClusterData = {
    cluster: string;
    namespaces: string[];
};

export type AcrData = {
    acr: string;
    repositories: RepositoryData[];
};

export type RepositoryData = {
    repository: string;
    tags: string[];
};

const appDeploymentSub: Subscription = { id: "f3adef54-889d-49cf-87c8-5fd622071914", name: "App Deployment Sub" };
const prodStoreSub: Subscription = { id: "49dfdd93-df02-46d3-86d2-f77ef1ab2a45", name: "Prod Store Sub" };
const testStoreSub: Subscription = { id: "c186e050-c6b9-43a7-bbd4-4608cac4ce88", name: "Test Store Sub" };

export function getAllSubscriptionData(): SubscriptionData[] {
    const subscriptions = [appDeploymentSub, prodStoreSub, testStoreSub];
    return subscriptions.map((sub) => createSubscriptionData(sub, ["aks-store-demo", "other-app"]));
}

function createSubscriptionData(subscription: Subscription, appNames: string[]): SubscriptionData {
    const appGroups = appNames.flatMap((appName) => [`${appName}-dev-rg`, `${appName}-test-rg`, `${appName}-prod-rg`]);
    const otherGroups = Array.from({ length: 5 }, (_, i) => `other-${String(i + 1).padStart(2, "0")}-rg`);
    return {
        subscription,
        resourceGroups: [...appGroups, ...otherGroups].map((group) => createResourceGroupData(group, appNames)),
    };
}

function createResourceGroupData(resourceGroup: string, appNames: string[]): ResourceGroupData {
    const groupNameParts = resourceGroup.replace(/-rg$/, "").split("-");
    const env = groupNameParts[groupNameParts.length - 1];

    const appAcrs = appNames.map((appName) => `${alphanumeric(appName)}${env}acr`);
    const otherAcrs = Array.from({ length: 5 }, (_, i) => `${env}acr${String(i + 1).padStart(2, "0")}`);

    const appClusters = appNames.map((appName) => `${appName}-${env}-cluster`);
    const otherClusters = Array.from({ length: 5 }, (_, i) => `${env}-cluster-${String(i + 1).padStart(2, "0")}`);

    const appNamespaces: string[] = appNames.map((appName) => `${appName}-ns`);

    return {
        group: resourceGroup,
        acrs: [...appAcrs, ...otherAcrs].map((acr) => createAcrData(acr, appNames)),
        clusters: [...appClusters, ...otherClusters].map((cluster) => createClusterData(cluster, appNamespaces)),
    };
}

function createAcrData(name: string, appNames: string[]): AcrData {
    const appRepos = appNames.map((appName) => `${alphanumeric(appName)}app`);
    const otherRepos = Array.from({ length: 5 }, (_, i) => `other/repo${String(i + 1).padStart(2, "0")}`);
    return {
        acr: name,
        repositories: [...appRepos, ...otherRepos].map((repo) => createRepositoryData(repo)),
    };
}

function createRepositoryData(name: string): RepositoryData {
    return {
        repository: name,
        tags: ["0.0.1", "0.0.2", "0.0.3", "0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.3.1", "latest"],
    };
}

function createClusterData(name: string, namespaces: string[]): ClusterData {
    return { cluster: name, namespaces };
}

function alphanumeric(value: string): string {
    return value.replace(/[^a-z0-9]/gi, "");
}
