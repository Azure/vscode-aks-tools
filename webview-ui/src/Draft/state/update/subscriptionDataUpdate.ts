import { ResourceGroupKey } from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../../utilities/lazy";
import { ResourceGroupReferenceData, SubscriptionReferenceData } from "../stateTypes";
import * as ResourceGroupDataUpdate from "./resourceGroupDataUpdate";

export function setResourceGroupsLoading(data: SubscriptionReferenceData): SubscriptionReferenceData {
    return { ...data, resourceGroups: newLoading() };
}

export function updateResourceGroups(
    data: SubscriptionReferenceData,
    resourceGroups: string[],
): SubscriptionReferenceData {
    const existingGroups = orDefault(data.resourceGroups, []);
    const newKeys: ResourceGroupKey[] = resourceGroups.map((resourceGroup) => ({
        subscriptionId: data.subscription.id,
        resourceGroup,
    }));
    const updatedGroups = updateValues(
        existingGroups,
        newKeys,
        (group) => group.key,
        (key) => ({
            key,
            acrs: newNotLoaded(),
            clusters: newNotLoaded(),
        }),
    );

    return {
        ...data,
        resourceGroups: newLoaded(updatedGroups),
    };
}

export function setAcrsLoading(data: SubscriptionReferenceData, resourceGroup: string): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) => ResourceGroupDataUpdate.setAcrsLoading(group));
}

export function updateAcrNames(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    acrNames: string[],
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) => ResourceGroupDataUpdate.updateAcrNames(group, acrNames));
}

export function setAcrRepositoriesLoading(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    acrName: string,
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.setAcrRepositoriesLoading(group, acrName),
    );
}

export function updateAcrRepositoryNames(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    acrName: string,
    repositoryNames: string[],
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.updateAcrRepositoryNames(group, acrName, repositoryNames),
    );
}

export function setAcrRepoTagsLoading(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    acrName: string,
    repositoryName: string,
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.setAcrRepoTagsLoading(group, acrName, repositoryName),
    );
}

export function updateAcrRepoTags(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    acrName: string,
    repositoryName: string,
    tags: string[],
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.updateAcrRepoTags(group, acrName, repositoryName, tags),
    );
}

export function setClustersLoading(data: SubscriptionReferenceData, resourceGroup: string): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) => ResourceGroupDataUpdate.setClustersLoading(group));
}

export function updateClusterNames(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    clusterNames: string[],
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.updateClusterNames(group, clusterNames),
    );
}

export function setClusterNamespacesLoading(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    clusterName: string,
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.setClusterNamespacesLoading(group, clusterName),
    );
}

export function updateClusterNamespaces(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    clusterName: string,
    namespaceNames: string[],
): SubscriptionReferenceData {
    return updateResourceGroup(data, resourceGroup, (group) =>
        ResourceGroupDataUpdate.updateClusterNamespaces(group, clusterName, namespaceNames),
    );
}

function updateResourceGroup(
    data: SubscriptionReferenceData,
    resourceGroup: string,
    updater: (data: ResourceGroupReferenceData) => ResourceGroupReferenceData,
): SubscriptionReferenceData {
    return {
        ...data,
        resourceGroups: lazyMap(data.resourceGroups, (groups) =>
            replaceItem(groups, (group) => group.key.resourceGroup === resourceGroup, updater),
        ),
    };
}
