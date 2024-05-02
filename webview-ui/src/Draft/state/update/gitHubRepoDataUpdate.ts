import { newLoaded, newLoading } from "../../../utilities/lazy";
import { GitHubRepositoryReferenceData } from "../stateTypes";

export function setBranchesLoading(data: GitHubRepositoryReferenceData): GitHubRepositoryReferenceData {
    return {
        ...data,
        branches: newLoading(),
    };
}

export function updateBranches(data: GitHubRepositoryReferenceData, branches: string[]): GitHubRepositoryReferenceData {
    return {
        ...data,
        branches: newLoaded(branches),
    };
}
