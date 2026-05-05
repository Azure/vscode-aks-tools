import * as vscode from "vscode";
import * as path from "path";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export interface SaveAllArgs {
    files: Array<{ filename: string; content: string }>;
    projectPath: string;
}

export async function saveAll(_ctx: IActionContext, args: SaveAllArgs): Promise<void> {
    if (!args.files?.length) {
        vscode.window.showErrorMessage("No files to save.");
        return;
    }

    const existingFiles = new Set<string>();
    for (const f of args.files) {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(args.projectPath), f.filename);
        try {
            await vscode.workspace.fs.stat(uri);
            existingFiles.add(f.filename);
        } catch {
            /* stat throws when file doesn't exist */
        }
    }

    let skipExisting = false;
    if (existingFiles.size > 0) {
        const result = await vscode.window.showWarningMessage(
            `${existingFiles.size} of ${args.files.length} files already exist. Overwrite all?`,
            { modal: true },
            "Overwrite all",
            "Skip existing",
            "Cancel",
        );
        if (result === undefined || result === "Cancel") {
            return;
        }
        if (result === "Skip existing") {
            skipExisting = true;
        } else {
            skipExisting = false;
        }
    }

    let savedCount = 0;
    let skippedCount = 0;

    for (const f of args.files) {
        if (skipExisting && existingFiles.has(f.filename)) {
            skippedCount++;
            continue;
        }

        if (path.normalize(f.filename).startsWith("..") || path.isAbsolute(f.filename)) {
            vscode.window.showErrorMessage(`Invalid filename: ${f.filename}`);
            continue;
        }

        const targetUri = vscode.Uri.joinPath(vscode.Uri.file(args.projectPath), f.filename);
        try {
            await vscode.workspace.fs.createDirectory(
                vscode.Uri.joinPath(vscode.Uri.file(args.projectPath), path.dirname(f.filename)),
            );
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(f.content, "utf8"));
            savedCount++;
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to save ${f.filename}: ${err}`);
        }
    }

    const message = `Saved ${savedCount} file(s). Skipped ${skippedCount}.`;
    const action = await vscode.window.showInformationMessage(message, "Show in Explorer");
    if (action === "Show in Explorer") {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(args.projectPath));
    }
}
