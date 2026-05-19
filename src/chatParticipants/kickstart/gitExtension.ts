import * as path from "path";
import * as vscode from "vscode";
import { Errorable, getErrorMessage } from "../../commands/utils/errorable";

// Subset of the vscode.git extension API we depend on.
// See https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
interface GitCloneOptions {
    parentPath?: vscode.Uri;
    ref?: string;
    recursive?: boolean;
    // 'none' suppresses the post-clone "Open / Add to Workspace" action.
    // When omitted, the user's git.openAfterClone setting is used (default: "prompt").
    postCloneAction?: "none";
}

interface GitAPI {
    clone(uri: vscode.Uri, options?: GitCloneOptions): Promise<vscode.Uri | null>;
}

interface GitExtensionExports {
    getAPI(version: 1): GitAPI;
}

export async function getGitApi(): Promise<Errorable<GitAPI>> {
    const ext: vscode.Extension<GitExtensionExports> | undefined = vscode.extensions.getExtension("vscode.git");
    if (!ext) {
        return { succeeded: false, error: "Git extension is not installed" };
    }

    try {
        if (!ext.isActive) {
            await ext.activate();
        }

        const gitApi = ext.exports.getAPI(1);
        return { succeeded: true, result: gitApi };
    } catch {
        return {
            succeeded: false,
            error: "Git extension API unavailable — enable the built-in Git extension and reload window",
        };
    }
}

export async function cloneSample(
    url: string,
    parentPath: string,
    targetName: string,
    token: vscode.CancellationToken,
): Promise<Errorable<string>> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: `Cloning ${targetName}…`,
        },
        async (_progress, progressToken) => {
            const checkCancelled = () => token.isCancellationRequested || progressToken.isCancellationRequested;

            if (checkCancelled()) {
                return { succeeded: false, error: "Clone cancelled" };
            }

            const gitApiResult = await getGitApi();
            if (!gitApiResult.succeeded) {
                return gitApiResult;
            }

            if (checkCancelled()) {
                return { succeeded: false, error: "Clone cancelled" };
            }

            try {
                // Modern Git extension API: clone(uri: Uri, options): Promise<Uri | null>.
                // - `parentPath` is the parent directory; the clone manager creates
                //   <parentPath>/<repo-name-from-url> inside it.
                // - `postCloneAction: 'none'` suppresses the "Open / Add to Workspace"
                //   prompt AND the sibling-root add, so kickstart fully owns workspace
                //   placement. Without this, the user's git.openAfterClone setting
                //   (default "prompt") drives a UI prompt that adds the cloned folder
                //   as a sibling root next to the Azure workspace.
                const resultUri = await gitApiResult.result.clone(vscode.Uri.parse(url), {
                    parentPath: vscode.Uri.file(parentPath),
                    recursive: true,
                    postCloneAction: "none",
                });

                if (!resultUri) {
                    return { succeeded: false, error: "Clone failed: no result path returned" };
                }

                const clonedPath = resultUri.fsPath;

                // The Git extension's clone manager keeps a cache of known cloned
                // repositories keyed by URL. If a clone already exists for this URL
                // (e.g. the parent workspace folder is itself a checkout of this
                // repo, or a prior clone was registered) the API returns that
                // existing path WITHOUT performing a clone. Detect when the result
                // is not a fresh child of `parentPath` and surface an actionable
                // error rather than silently treating the parent as the sample.
                const normalizedParent = path.resolve(parentPath);
                const normalizedResult = path.resolve(clonedPath);
                const isFreshChild =
                    normalizedResult !== normalizedParent &&
                    (normalizedResult + path.sep).startsWith(normalizedParent + path.sep);

                if (!isFreshChild) {
                    return {
                        succeeded: false,
                        error:
                            `This repository is already checked out at ${normalizedResult}. ` +
                            `Use "Use current workspace folder" to continue with the existing checkout, ` +
                            `or remove it and try again.`,
                    };
                }

                return { succeeded: true, result: clonedPath };
            } catch (error) {
                return { succeeded: false, error: getErrorMessage(error) };
            }
        },
    );
}
