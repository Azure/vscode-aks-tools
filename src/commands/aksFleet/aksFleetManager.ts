import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getCredential, getReadySessionProvider } from "../../auth/azureAuth";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getResourceGroups } from "../utils/resourceGroups";
import { createFleet } from "../../panels/CreateFleetPanel";
import { ContainerServiceFleetClient } from "@azure/arm-containerservicefleet";

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

    const subscriptionId = subscriptionNode.result?.subscriptionId;
    const subscriptionName = subscriptionNode.result?.name;
    const resourceGroup = await getResourceGroups(sessionProvider.result, subscriptionId);

    if (failed(resourceGroup)) {
        vscode.window.showErrorMessage(resourceGroup.error);
        return;
    }

    if (!subscriptionId || !subscriptionName) {
        vscode.window.showErrorMessage("Subscription ID or Name is undefined.");
        return;
    }

    // Temporary code for incremental check-in.
    // TODO: Replace hardcoded values with dynamic parameters or configuration settings.

    // Initialize the ContainerServiceFleetClient with session credentials and subscription ID.
    // Hardcoded 'subscriptionId' should be parameterized in future updates.
    const client = new ContainerServiceFleetClient(
        getCredential(sessionProvider.result), // Retrieve credentials from session provider.
        subscriptionId, // TODO: Ensure subscriptionId is dynamically passed or configured.
    );

    // Create a fleet using hardcoded parameters.
    // TODO: Replace hardcoded 'Fleet-Resource-Name', 'Fleet-Name', and 'Australia East' with configurable inputs.
    createFleet(
        client,
        "Fleet-Resource-Name", // Fleet resource group name (hardcoded).
        "Fleet-Name", // Fleet name (hardcoded).
        { location: "Australia East" }, // Location (hardcoded).
    );

    // NOTE: This temporary implementation assumes static context for testing purposes.
    // Ensure these hardcoded values are replaced with appropriate dynamic configurations
    // before finalizing this code for production level work which will be user focused.
}
