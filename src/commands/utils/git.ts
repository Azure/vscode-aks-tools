import { extensions } from "vscode";
import { API, GitExtension } from "../../types/git";
import { Errorable } from "./errorable";

export function getGitApi(): Errorable<API> {
    const gitExtension = extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
        return { succeeded: false, error: "Git extension not found" };
    }

    const git = gitExtension.exports.getAPI(1);
    return { succeeded: true, result: git };
}
