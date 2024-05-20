import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../../utilities/lazy";
import { AcrReferenceData, RepositoryReferenceData } from "../stateTypes";
import * as AcrRepoDataUpdate from "./acrRepoDataUpdate";

export function setRepositoriesLoading(data: AcrReferenceData): AcrReferenceData {
    return { ...data, repositories: newLoading() };
}

export function updateRepositoryNames(data: AcrReferenceData, repositoryNames: string[]): AcrReferenceData {
    const existingRepos = orDefault(data.repositories, []);
    const updatedRepos = updateValues(
        existingRepos,
        repositoryNames,
        (name, repo) => name === repo.key.repositoryName,
        (name) => ({
            key: {
                subscriptionId: data.key.subscriptionId,
                resourceGroup: data.key.resourceGroup,
                acrName: data.key.acrName,
                repositoryName: name,
            },
            tags: newNotLoaded(),
        }),
    );

    return {
        ...data,
        repositories: newLoaded(updatedRepos),
    };
}

export function setRepoTagsLoading(data: AcrReferenceData, repositoryName: string): AcrReferenceData {
    return updateRepository(data, repositoryName, (repository) => AcrRepoDataUpdate.setTagsLoading(repository));
}

export function updateRepoTags(data: AcrReferenceData, repositoryName: string, tags: string[]): AcrReferenceData {
    return updateRepository(data, repositoryName, (repository) => AcrRepoDataUpdate.updateTags(repository, tags));
}

function updateRepository(
    data: AcrReferenceData,
    repositoryName: string,
    updater: (data: RepositoryReferenceData) => RepositoryReferenceData,
): AcrReferenceData {
    return {
        ...data,
        repositories: lazyMap(data.repositories, (repositories) =>
            replaceItem(repositories, (repository) => repository.key.repositoryName === repositoryName, updater),
        ),
    };
}
