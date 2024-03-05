import { replaceItem } from "../../../utilities/array";
import { ForkReferenceData, GitHubReferenceData } from "../stateTypes";
import * as ForkDataUpdate from "./forkDataUpdate";

export function setForkBranchesLoading(data: GitHubReferenceData, forkName: string): GitHubReferenceData {
    return updateFork(data, forkName, (fork) => ForkDataUpdate.setBranchesLoading(fork));
}

export function updateForkBranches(
    data: GitHubReferenceData,
    forkName: string,
    branches: string[],
): GitHubReferenceData {
    return updateFork(data, forkName, (fork) => ForkDataUpdate.updateBranches(fork, branches));
}

function updateFork(
    data: GitHubReferenceData,
    forkName: string,
    updater: (data: ForkReferenceData) => ForkReferenceData,
): GitHubReferenceData {
    return {
        ...data,
        forks: replaceItem(data.forks, (data) => data.fork.name === forkName, updater),
    };
}
