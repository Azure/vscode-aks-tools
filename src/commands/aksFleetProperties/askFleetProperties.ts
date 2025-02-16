import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAksFleetTreeNode, getFleet } from "../utils/fleet";
import { getAksFleetClient } from "../utils/arm";

export default async function aksFleetProperties(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const clusterNode = getAksFleetTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    // Fetch a fleet using hardcoded parameters.
    // TODO: Replace hardcoded 'Fleet-Name', 'Resource-Group', and 'Subscription-Id' with configurable inputs.
    const name = "Fleet-Name";
    const resourceGroup = "Resource-Group";
    const subscriptionId = "Subscription-Id";
    const client = getAksFleetClient(sessionProvider.result, subscriptionId);
    getFleet(client, resourceGroup, name);

    // NOTE: This temporary implementation assumes static context for testing purposes.
    // Ensure these hardcoded values are replaced with appropriate dynamic configurations
    // before finalizing this code for production level work which will be user focused.
}
