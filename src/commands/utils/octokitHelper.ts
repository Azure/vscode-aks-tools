import { Octokit } from "@octokit/rest";
import { Errorable, getErrorMessage } from "./errorable";

//Returns a list of repositories for the authenticated user
export async function getGitHubRepos(octokitClient: Octokit): Promise<Errorable<string[]>> {
    let octoResp: Awaited<ReturnType<typeof octokitClient.repos.listForAuthenticatedUser>>;
    try {
        octoResp = await octokitClient.repos.listForAuthenticatedUser({});
    } catch (error) {
        console.error("Error fetching repositories:", getErrorMessage(error));
        return { succeeded: false, error: "Error fetching repositories" };
    }

    const repoNames = octoResp.data.map((repo) => repo.name);

    return { succeeded: true, result: repoNames };
}

//Returns a list of branches for a given repository
export async function getGitHubBranchesForRepo(
    octokitClient: Octokit,
    owner: string,
    repo: string,
): Promise<Errorable<string[]>> {
    let octoResp: Awaited<ReturnType<typeof octokitClient.repos.listBranches>>;
    try {
        octoResp = await octokitClient.repos.listBranches({ owner, repo });
    } catch (error) {
        console.error("Error fetching branches:", getErrorMessage(error));
        return { succeeded: false, error: "Error fetching branches" };
    }

    const branchNames = octoResp.data.map((branch) => branch.name);

    return { succeeded: true, result: branchNames };
}
