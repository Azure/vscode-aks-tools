import * as vscode from 'vscode';

export function checkExtension(ext: string): boolean {
    let extensions = vscode.extensions.all;
    extensions = extensions.filter(extension => extension.id === ext);

    return extensions.length !== 0;
}

export async function handleExtensionDoesNotExist(ext: string): Promise<void> {
    await vscode.window.showWarningMessage(`Extension with id : "${ext}" must be installed to use this feature.`,
        "Install from Marketplace").then(async (selection) => {
        if (selection === "Install from Marketplace") {
            await vscode.commands.executeCommand("extension.open", ext);
        }
    });
}