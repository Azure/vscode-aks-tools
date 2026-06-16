import * as vscode from "vscode";

/** Opens the given markdown string in an untitled preview editor. */
export async function openMarkdownReport(markdown: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content: markdown, language: "markdown" });
    await vscode.window.showTextDocument(doc, { preview: true });
}
