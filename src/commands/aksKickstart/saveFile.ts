import * as vscode from "vscode";
import * as path from "path";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export interface SaveFileArgs {
    filename: string;
    content: string;
    projectPath: string;
}

export async function saveFile(_ctx: IActionContext, args: SaveFileArgs): Promise<void> {
    if (path.normalize(args.filename).startsWith("..") || path.isAbsolute(args.filename)) {
        vscode.window.showErrorMessage(`Invalid filename: ${args.filename}`);
        return;
    }

    const targetUri = vscode.Uri.joinPath(vscode.Uri.file(args.projectPath), args.filename);

    await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(vscode.Uri.file(args.projectPath), path.dirname(args.filename)),
    );

    let fileExists: boolean;
    try {
        await vscode.workspace.fs.stat(targetUri);
        fileExists = true;
    } catch {
        fileExists = false;
    }

    if (fileExists) {
        const result = await vscode.window.showWarningMessage(
            `${args.filename} already exists. Overwrite?`,
            { modal: true },
            "Overwrite",
            "Open existing",
        );
        if (result === "Open existing") {
            await vscode.window.showTextDocument(targetUri);
            return;
        }
        if (result !== "Overwrite") {
            return;
        }
    }

    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(args.content, "utf8"));
    await vscode.window.showTextDocument(targetUri);
    vscode.window.showInformationMessage(`Saved ${args.filename}`);
}
