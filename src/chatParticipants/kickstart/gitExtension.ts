import * as path from "path";
import * as vscode from "vscode";
import { Errorable, getErrorMessage } from "../../commands/utils/errorable";

// TODO: See https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
interface GitAPI {
    clone(url: string, parentPath: string, options?: { parentPath?: string; recursive?: boolean }): Promise<string>;
}

// The vscode.git extension exports an object with a getAPI method.
// vscode.Extension<T>.exports is T, so we type the extension as having getAPI directly.
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

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    } catch {
        return false;
    }
}

function isSafeTargetName(targetName: string): boolean {
    return targetName === path.basename(targetName) && targetName !== "." && targetName !== "..";
}

async function getUniqueCloneTargetPath(parentPath: string, targetName: string): Promise<Errorable<string>> {
    if (!isSafeTargetName(targetName)) {
        return { succeeded: false, error: "Invalid target name" };
    }

    const basePath = path.resolve(parentPath);
    let cloneTargetPath = path.resolve(basePath, targetName);

    let suffix = 1;
    while (await pathExists(cloneTargetPath)) {
        cloneTargetPath = path.resolve(basePath, `${targetName}-${suffix}`);
        suffix++;
    }

    const relativePath = path.relative(basePath, cloneTargetPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return { succeeded: false, error: "Invalid target name" };
    }

    return { succeeded: true, result: cloneTargetPath };
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
        },
        async (_, progressToken) => {
            const checkCancelled = () => token.isCancellationRequested || progressToken.isCancellationRequested;

            if (checkCancelled()) {
                return { succeeded: false, error: "Clone cancelled" };
            }

            const gitApiResult = await getGitApi();
            if (!gitApiResult.succeeded) {
                return gitApiResult;
            }

            const targetResult = await getUniqueCloneTargetPath(parentPath, targetName);
            if (!targetResult.succeeded) {
                return targetResult;
            }

            if (checkCancelled()) {
                return { succeeded: false, error: "Clone cancelled" };
            }

            try {
                await gitApiResult.result.clone(url, parentPath, { parentPath: targetResult.result, recursive: true });
                return { succeeded: true, result: targetResult.result };
            } catch (error) {
                return { succeeded: false, error: getErrorMessage(error) };
            }
        },
    );
}
