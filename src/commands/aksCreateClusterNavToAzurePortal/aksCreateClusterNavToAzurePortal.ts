import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getPortalCreateUrl } from "../utils/env";
import { getEnvironment } from "../../auth/azureAuth";

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

    vscode.env.openExternal(vscode.Uri.parse(getPortalCreateUrl(getEnvironment(), "create/microsoft.aks")));
}
