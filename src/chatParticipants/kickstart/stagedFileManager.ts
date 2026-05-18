import * as vscode from "vscode";
import { StagedFile } from "./state";

/**
 * Manages generated files for a kickstart session using VS Code's workspace.fs API.
 *
 * Files are written to the extension's workspace storage directory
 * (context.storageUri), which works on both VS Code Desktop and VS Code for
 * the Web (vscode.dev/azure — backed by IndexedDB there).
 *
 * Files are only written to the user's actual workspace when they click
 * "Save to project" (via triggerAcceptAll → workspace.fs).
 */
export class StagedFileManager {
    readonly stagingRoot: vscode.Uri;

    constructor(storageUri: vscode.Uri) {
        this.stagingRoot = vscode.Uri.joinPath(storageUri, "kickstart-staging");
    }

    /**
     * Writes the file to extension storage and returns a StagedFile record.
     * The stagedPath is a VS Code URI string that can be opened with
     * workspace.openTextDocument() on Desktop and Web.
     */
    async stage(filename: string, content: string): Promise<StagedFile> {
        const parts = filename.split("/");
        const fileUri = vscode.Uri.joinPath(this.stagingRoot, ...parts);

        // Ensure parent directory exists
        const dirUri =
            parts.length > 1 ? vscode.Uri.joinPath(this.stagingRoot, ...parts.slice(0, -1)) : this.stagingRoot;
        await vscode.workspace.fs.createDirectory(dirUri);

        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));

        return {
            filename,
            content,
            stagedPath: fileUri.toString(),
            status: "staged",
            generatedAt: Date.now(),
        };
    }
}
