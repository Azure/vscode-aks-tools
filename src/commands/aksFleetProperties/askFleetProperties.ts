import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAksFleetTreeNode } from "../utils/fleet";
import { FleetPropertiesDataProvider, FleetPropertiesPanel } from "../../panels/FleetPropertiesPanel";

export default async function aksFleetProperties(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const fleetNode = getAksFleetTreeNode(target, cloudExplorer);
    if (failed(fleetNode)) {
        vscode.window.showErrorMessage(fleetNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const dataProvider = new FleetPropertiesDataProvider(
        sessionProvider.result,
        fleetNode.result.subscriptionId,
        fleetNode.result.resourceGroupName,
        fleetNode.result.name,
    );

    const panel = new FleetPropertiesPanel(extension.result.extensionUri);
    panel.show(dataProvider);
}
