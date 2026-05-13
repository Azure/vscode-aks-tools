import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Errorable } from "../utils/errorable";
import { cloneSample } from "../../chatParticipants/kickstart/gitExtension";
import { KICKSTART_SAMPLE_REPOS } from "../../chatParticipants/kickstart/config";

export async function useWorkspace(): Promise<Errorable<string>> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return { succeeded: false, error: "Open a folder in VS Code first." };
    }

    if (folders.length === 1) {
        return { succeeded: true, result: folders[0].uri.fsPath };
    }

    const picked = await vscode.window.showWorkspaceFolderPick();
    if (!picked) {
        return { succeeded: false, error: "Cancelled." };
    }

    return { succeeded: true, result: picked.uri.fsPath };
}

export const KICKSTART_TEMP_ROOT = path.join(os.tmpdir(), "kickstart-samples");

export async function useSample(
    token: vscode.CancellationToken,
    parentPath: string = KICKSTART_TEMP_ROOT,
): Promise<Errorable<string>> {
    const picked = await vscode.window.showQuickPick(
        KICKSTART_SAMPLE_REPOS.map((r) => ({
            label: r.label,
            description: r.description,
            url: r.url,
        })),
        {
            placeHolder: "Choose a sample project to containerize",
            title: "Kickstart: Sample Repos",
        },
    );

    if (!picked) {
        return { succeeded: false, error: "Cancelled." };
    }

    const repoName =
        picked.url
            .split("/")
            .pop()
            ?.replace(/\.git$/, "") ?? "sample";

    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentPath));
    } catch {
        // directory already exists — safe to ignore
    }

    const cloneResult = await cloneSample(picked.url, parentPath, repoName, token);
    if (!cloneResult.succeeded) {
        return cloneResult;
    }

    return { succeeded: true, result: cloneResult.result };
}
