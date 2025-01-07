import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";
import { getResourceGroups } from "../utils/resourceGroups";
import { CreateFleetDataProvider, CreateFleetPanel } from "../../panels/CreateFleetPanel";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 *
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateFleet(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const sessionProvider = await getReadySessionProvider();

    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);

    if (failed(subscriptionNode)) {
        vscode.window.showErrorMessage(subscriptionNode.error);
        return;
    }

    if (!subscriptionNode.result?.subscriptionId || !subscriptionNode.result?.name) {
        vscode.window.showErrorMessage("Subscription not found.");
        return;
    }

    const subscriptionId = subscriptionNode.result?.subscriptionId;
    const subscriptionName = subscriptionNode.result?.name;

    if (!subscriptionNode.result?.subscriptionId || !subscriptionNode.result?.name) {
        vscode.window.showErrorMessage("Subscription not found.");
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    // make fleet creation call here
    const resourceGroup = await getResourceGroups(sessionProvider.result, subscriptionId);

    if (failed(resourceGroup)) {
        vscode.window.showErrorMessage(resourceGroup.error);
        return;
    }

    const panel = new CreateFleetPanel(extension.result.extensionUri);

    if (!subscriptionId || !subscriptionName) {
        vscode.window.showErrorMessage("Subscription ID or Name is undefined.");
        return;
    }

    const dataProvider = new CreateFleetDataProvider(
        sessionProvider.result,
        subscriptionId,
        subscriptionNode.result?.name,
    );

    panel.show(dataProvider);

    // Fleet API call.
    // https://learn.microsoft.com/en-nz/rest/api/fleet/fleets/create-or-update?view=rest-fleet-2023-10-15&tabs=JavaScript
}
