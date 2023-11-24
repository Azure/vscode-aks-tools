import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";

export default async function selectSubscriptions(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    if (cloudExplorer.available) {
        const commandTarget = cloudExplorer.api.resolveCommandTarget(target);

        if (commandTarget && commandTarget.nodeType === "resource") {
            vscode.commands.executeCommand("azure-account.selectSubscriptions");
        }
    }
}
