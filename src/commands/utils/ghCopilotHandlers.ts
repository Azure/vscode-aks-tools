import * as vscode from "vscode";

export function checkExtension(ext: string): boolean {
    let extensions = vscode.extensions.all;
    extensions = extensions.filter((extension) => extension.id === ext);

    return extensions.length !== 0;
}

export function handleExtensionDoesNotExist(ext: string): void {
    vscode.window
        .showWarningMessage(
            `Extension with id : "${ext}" must be installed to use this feature.`,
            "Install from Marketplace",
        )
        .then((selection) => {
            if (selection === "Install from Marketplace") {
                vscode.commands.executeCommand("extension.open", ext);
            }
        });
}
