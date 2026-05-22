import * as vscode from "vscode";
import { Errorable } from "../utils/errorable";
import { cloneSample } from "../../chatParticipants/kickstart/gitExtension";
import { KICKSTART_SAMPLE_REPO_URL } from "../../chatParticipants/kickstart/config";

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

export async function useSample(token: vscode.CancellationToken): Promise<Errorable<string>> {
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select clone destination",
    });

    if (!uris || uris.length === 0) {
        return { succeeded: false, error: "Cancelled." };
    }

    const parentPath = uris[0].fsPath;
    const repoName =
        KICKSTART_SAMPLE_REPO_URL.split("/")
            .pop()
            ?.replace(/\.git$/, "") ?? "aks-store-demo";

    try {
        const cloneResult = await cloneSample(KICKSTART_SAMPLE_REPO_URL, parentPath, repoName, token);
        if (!cloneResult.succeeded) {
            return cloneResult;
        }

        const clonedPath = cloneResult.result;
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(clonedPath), {
            forceNewWindow: false,
        });

        return { succeeded: true, result: clonedPath };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { succeeded: false, error: message };
    }
}
