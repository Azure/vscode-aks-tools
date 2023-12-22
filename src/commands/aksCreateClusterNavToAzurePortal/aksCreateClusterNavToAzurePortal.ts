import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";

export default async function aksCreateClusterNavToAzurePortal(
    _context: IActionContext,
    target: unknown,
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
    if (failed(subscriptionNode)) {
        vscode.window.showErrorMessage(subscriptionNode.error);
        return;
    }

    vscode.env.openExternal(vscode.Uri.parse(`https://portal.azure.com/#create/microsoft.aks`));
}
