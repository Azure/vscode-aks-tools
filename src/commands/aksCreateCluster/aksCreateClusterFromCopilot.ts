import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

export async function aksCreateClusterFromCopilot(_context: IActionContext, subscriptionId: string): Promise<void> {
    vscode.commands.executeCommand("aks.createCluster", subscriptionId);
}
