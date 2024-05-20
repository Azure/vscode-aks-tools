import { extensions } from "vscode";
import { API, GitExtension } from "../../types/git";
import { Errorable } from "./errorable";

/**
 * Gets the Git extension API. This is a built-in extension which we can use to examine the local Git repository,
 * e.g. what branches or remotes exist, and the state of the workspace.
 */
export function getGitApi(): Errorable<API> {
    const gitExtension = extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
        return { succeeded: false, error: "Git extension not found" };
    }

    const git = gitExtension.exports.getAPI(1);
    return { succeeded: true, result: git };
}
