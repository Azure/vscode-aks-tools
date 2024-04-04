import { WorkspaceFolder, commands } from "vscode";
import { VsCodeCommand } from "../../webview-contract/webviewDefinitions/draft/types";

export function launchCommandInWorkspaceFolder(command: VsCodeCommand, workspaceFolder: WorkspaceFolder): void {
    switch (command) {
        case VsCodeCommand.DraftDeployment:
            commands.executeCommand("aks.draftDeployment", workspaceFolder);
            break;
        case VsCodeCommand.DraftWorkflow:
            commands.executeCommand("aks.draftWorkflow", workspaceFolder);
            break;
    }
}
