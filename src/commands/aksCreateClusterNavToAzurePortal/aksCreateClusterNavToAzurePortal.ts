import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem } from "../utils/clusters";
import { failed } from "../utils/errorable";

export default async function aksCreateClusterNavToAzurePortal(
    _context: IActionContext,
    target: unknown,
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterSubscriptionItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    vscode.env.openExternal(vscode.Uri.parse(`https://portal.azure.com/#create/microsoft.aks`));
}
