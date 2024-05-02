import {
    AcrKey,
    ClusterKey,
    RepositoryKey,
    acrKeysMatch,
    clusterKeysMatch,
} from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../../utilities/lazy";
import { AcrReferenceData, ClusterReferenceData, SubscriptionReferenceData } from "../stateTypes";
import * as AcrDataUpdate from "./acrDataUpdate";
import * as ClusterDataUpdate from "./clusterDataUpdate";

export function setAcrsLoading(data: SubscriptionReferenceData): SubscriptionReferenceData {
    return { ...data, acrs: newLoading() };
}

export function updateAcrNames(data: SubscriptionReferenceData, newKeys: AcrKey[]): SubscriptionReferenceData {
    const existingAcrs = orDefault(data.acrs, []);
    const updatedAcrs = updateValues(
        existingAcrs,
        newKeys,
        (acr, item) => acr.resourceGroup === item.key.resourceGroup && acr.acrName === item.key.acrName,
        (key) => ({
            key,
            repositories: newNotLoaded(),
        }),
    );

    return {
        ...data,
        acrs: newLoaded(updatedAcrs),
    };
}

export function setAcrRepositoriesLoading(data: SubscriptionReferenceData, acrKey: AcrKey): SubscriptionReferenceData {
    return updateAcr(data, acrKey, (acr) => AcrDataUpdate.setRepositoriesLoading(acr));
}

export function updateAcrRepositoryNames(
    data: SubscriptionReferenceData,
    acrKey: AcrKey,
    repositoryNames: string[],
): SubscriptionReferenceData {
    return updateAcr(data, acrKey, (acr) => AcrDataUpdate.updateRepositoryNames(acr, repositoryNames));
}

export function setAcrRepoTagsLoading(
    data: SubscriptionReferenceData,
    repositoryKey: RepositoryKey,
): SubscriptionReferenceData {
    return updateAcr(data, repositoryKey, (acr) => AcrDataUpdate.setRepoTagsLoading(acr, repositoryKey.repositoryName));
}

export function updateAcrRepoTags(
    data: SubscriptionReferenceData,
    repositoryKey: RepositoryKey,
    tags: string[],
): SubscriptionReferenceData {
    return updateAcr(data, repositoryKey, (acr) =>
        AcrDataUpdate.updateRepoTags(acr, repositoryKey.repositoryName, tags),
    );
}

export function setClustersLoading(data: SubscriptionReferenceData): SubscriptionReferenceData {
    return { ...data, clusters: newLoading() };
}

export function updateClusterNames(data: SubscriptionReferenceData, newKeys: ClusterKey[]): SubscriptionReferenceData {
    const existingClusters = orDefault(data.clusters, []);
    const updatedClusters = updateValues(
        existingClusters,
        newKeys,
        (cluster, item) =>
            cluster.resourceGroup === item.key.resourceGroup && cluster.clusterName === item.key.clusterName,
        (key) => ({
            key,
            namespaces: newNotLoaded(),
        }),
    );

    return {
        ...data,
        clusters: newLoaded(updatedClusters),
    };
}

export function setClusterNamespacesLoading(
    data: SubscriptionReferenceData,
    clusterKey: ClusterKey,
): SubscriptionReferenceData {
    return updateCluster(data, clusterKey, (cluster) => ClusterDataUpdate.setNamespacesLoading(cluster));
}

export function updateClusterNamespaces(
    data: SubscriptionReferenceData,
    clusterKey: ClusterKey,
    namespaceNames: string[],
): SubscriptionReferenceData {
    return updateCluster(data, clusterKey, (cluster) => ClusterDataUpdate.updateNamespaces(cluster, namespaceNames));
}

function updateAcr(
    data: SubscriptionReferenceData,
    acrKey: AcrKey,
    updater: (data: AcrReferenceData) => AcrReferenceData,
): SubscriptionReferenceData {
    return {
        ...data,
        acrs: lazyMap(data.acrs, (acrs) => replaceItem(acrs, (data) => acrKeysMatch(data.key, acrKey), updater)),
    };
}

function updateCluster(
    data: SubscriptionReferenceData,
    clusterKey: ClusterKey,
    updater: (data: ClusterReferenceData) => ClusterReferenceData,
): SubscriptionReferenceData {
    return {
        ...data,
        clusters: lazyMap(data.clusters, (clusters) =>
            replaceItem(clusters, (data) => clusterKeysMatch(data.key, clusterKey), updater),
        ),
    };
}
