import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { selectSubscription } from "../aksAccount/aksAccount";

export async function aksCreateClusterFromCopilot(_context: IActionContext): Promise<void> {
    const subscriptionId = await selectSubscription();

    if (!subscriptionId) {
        vscode.window.showErrorMessage("A Subscription Id is required to create an AKS cluster.");
        return;
    }

    vscode.commands.executeCommand("aks.createCluster", subscriptionId);
}
