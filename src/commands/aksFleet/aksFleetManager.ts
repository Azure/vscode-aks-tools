import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getResourceGroups } from "../utils/resourceGroups";
import { CreateFleetDataProvider, CreateFleetPanel } from "../../panels/CreateFleetPanel";
import { getExtension } from "../utils/host";

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

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const panel = new CreateFleetPanel(extension.result.extensionUri);
    const dataProvider = new CreateFleetDataProvider(sessionProvider.result, subscriptionId, subscriptionName);
    panel.show(dataProvider);
}
