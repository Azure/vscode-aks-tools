import * as vscode from "vscode";

export default async function aksProvideFeedback(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openIssueReporter", {
        extensionId: "ms-kubernetes-tools.vscode-aks-tools",
    });
}
