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

// The raw item as it might be received from Octokit
interface RawTreeItem {
    path?: string;
    mode?: string;
    type?: string;
    sha?: string;
    size?: number;
    url?: string;
}

interface FlatTreeItem {
    path: string;
    type: "blob" | "tree";
}

export interface TreeNode extends FlatTreeItem {
    name: string;
    children: TreeNode[];
}

// Octokit response is a 'raw' flat tree, after values are verifed as not undefined and type is 'tree' or 'blob' then it's considered a flat tree
// The flat tree is then converted to a nested tree structure that can be used to display the tree in the UI
// Raw Tree -> Flat Tree -> Nested Tree
export function buildTree(rawTree: RawTreeItem[]): TreeNode {
    const flatTree = convertRawToFlat(rawTree);

    // Create a dummy root node.
    const root: TreeNode = { name: "root", path: "", type: "tree", children: [] };

    flatTree.forEach((item) => {
        const parts = item.path.split("/");
        let current = root;

        parts.forEach((part) => {
            // Look for an existing child with this name.
            let child = current.children.find((child) => child.name === part);
            if (!child) {
                // If we are at the last part, use the type from the item; otherwise, it's a folder.
                child = {
                    name: part,
                    path: [current.path, part].filter(Boolean).join("/"),
                    type: item.type,
                    children: [],
                };
                current.children.push(child);
            }
            current = child;
        });
    });

    return root;
}

//Converts an array of RawTreeItem into FlatTreeItem by filtering out items missing required properties and mapping the type properly.
function convertRawToFlat(rawItems: RawTreeItem[]): FlatTreeItem[] {
    return (
        rawItems
            // Filter out any items that don't have a defined path or type
            .filter((item): item is RawTreeItem => item.path !== undefined && item.type !== undefined)
            .map((item) => ({
                path: item.path as string,
                // Ensure that type is only 'tree' or 'blob'
                type: item.type === "tree" ? "tree" : "blob",
            }))
    );
}
