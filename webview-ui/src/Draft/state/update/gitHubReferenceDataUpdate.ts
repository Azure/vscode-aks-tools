import { GitHubRepoKey } from "../../../../../src/webview-contract/webviewDefinitions/draft/types";
import { replaceItem } from "../../../utilities/array";
import { GitHubReferenceData, GitHubRepositoryReferenceData } from "../stateTypes";
import * as RepoDataUpdate from "./gitHubRepoDataUpdate";

export function setBranchesLoading(data: GitHubReferenceData, repoKey: GitHubRepoKey): GitHubReferenceData {
    return updateRepository(data, repoKey, (repoData) => RepoDataUpdate.setBranchesLoading(repoData));
}

export function updateBranches(
    data: GitHubReferenceData,
    repoKey: GitHubRepoKey,
    branches: string[],
): GitHubReferenceData {
    return updateRepository(data, repoKey, (repoData) => RepoDataUpdate.updateBranches(repoData, branches));
}

function updateRepository(
    data: GitHubReferenceData,
    repoKey: GitHubRepoKey,
    updater: (data: GitHubRepositoryReferenceData) => GitHubRepositoryReferenceData,
): GitHubReferenceData {
    return {
        ...data,
        repositories: replaceItem(
            data.repositories,
            (data) =>
                data.repository.gitHubRepoOwner === repoKey.gitHubRepoOwner &&
                data.repository.gitHubRepoName === repoKey.gitHubRepoName,
            updater,
        ),
    };
}
