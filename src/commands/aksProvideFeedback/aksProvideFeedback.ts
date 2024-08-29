import * as vscode from "vscode";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export default async function aksProvideFeedback(_context: IActionContext): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openIssueReporter", {
        extensionId: "ms-kubernetes-tools.vscode-aks-tools",
    });
}
