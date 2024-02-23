import { AcrKey, ClusterKey } from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../../utilities/lazy";
import { AcrReferenceData, ClusterReferenceData, ResourceGroupReferenceData } from "../stateTypes";
import * as AcrDataUpdate from "./acrDataUpdate";
import * as ClusterDataUpdate from "./clusterDataUpdate";

export function setAcrsLoading(data: ResourceGroupReferenceData): ResourceGroupReferenceData {
    return { ...data, acrs: newLoading() };
}

export function setClustersLoading(data: ResourceGroupReferenceData): ResourceGroupReferenceData {
    return { ...data, clusters: newLoading() };
}

export function updateAcrNames(data: ResourceGroupReferenceData, acrNames: string[]): ResourceGroupReferenceData {
    const existingAcrs = orDefault(data.acrs, []);
    const newKeys: AcrKey[] = acrNames.map((acrName) => ({ ...data.key, acrName }));
    const updatedAcrs = updateValues(
        existingAcrs,
        newKeys,
        (acr) => acr.key,
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

export function updateClusterNames(
    data: ResourceGroupReferenceData,
    clusterNames: string[],
): ResourceGroupReferenceData {
    const existingClusters = orDefault(data.clusters, []);
    const newKeys: ClusterKey[] = clusterNames.map((clusterName) => ({ ...data.key, clusterName }));
    const updatedClusters = updateValues(
        existingClusters,
        newKeys,
        (cluster) => cluster.key,
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

export function setAcrRepositoriesLoading(
    data: ResourceGroupReferenceData,
    acrName: string,
): ResourceGroupReferenceData {
    return updateAcr(data, acrName, (acr) => AcrDataUpdate.setRepositoriesLoading(acr));
}

export function updateAcrRepositoryNames(
    data: ResourceGroupReferenceData,
    acrName: string,
    repositoryNames: string[],
): ResourceGroupReferenceData {
    return updateAcr(data, acrName, (acr) => AcrDataUpdate.updateRepositoryNames(acr, repositoryNames));
}

export function setAcrRepoTagsLoading(
    data: ResourceGroupReferenceData,
    acrName: string,
    repositoryName: string,
): ResourceGroupReferenceData {
    return updateAcr(data, acrName, (acr) => AcrDataUpdate.setRepoTagsLoading(acr, repositoryName));
}

export function updateAcrRepoTags(
    data: ResourceGroupReferenceData,
    acrName: string,
    repositoryName: string,
    tags: string[],
): ResourceGroupReferenceData {
    return updateAcr(data, acrName, (acr) => AcrDataUpdate.updateRepoTags(acr, repositoryName, tags));
}

export function setClusterNamespacesLoading(
    data: ResourceGroupReferenceData,
    clusterName: string,
): ResourceGroupReferenceData {
    return updateCluster(data, clusterName, (cluster) => ClusterDataUpdate.setNamespacesLoading(cluster));
}

export function updateClusterNamespaces(
    data: ResourceGroupReferenceData,
    clusterName: string,
    namespaceNames: string[],
): ResourceGroupReferenceData {
    return updateCluster(data, clusterName, (cluster) => ClusterDataUpdate.updateNamespaces(cluster, namespaceNames));
}

function updateAcr(
    data: ResourceGroupReferenceData,
    acrName: string,
    updater: (data: AcrReferenceData) => AcrReferenceData,
): ResourceGroupReferenceData {
    return {
        ...data,
        acrs: lazyMap(data.acrs, (acrs) => replaceItem(acrs, (acr) => acr.key.acrName === acrName, updater)),
    };
}

function updateCluster(
    data: ResourceGroupReferenceData,
    clusterName: string,
    updater: (data: ClusterReferenceData) => ClusterReferenceData,
): ResourceGroupReferenceData {
    return {
        ...data,
        clusters: lazyMap(data.clusters, (clusters) =>
            replaceItem(clusters, (c) => c.key.clusterName === clusterName, updater),
        ),
    };
}
