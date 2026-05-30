import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";

export default async function aksAskAzureCopilot(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const { name, armId } = clusterNode.result;
    const query = `@azure I'd like to talk about my ${name} Azure Kubernetes Service cluster (resource ID: ${armId}).`;

    await vscode.commands.executeCommand("workbench.action.chat.open", { query });
}
