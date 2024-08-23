import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { KaitoPanel, KaitoPanelDataProvider } from "../../panels/KaitoPanel";
import { getAksClusterTreeNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import { getExtension } from "../utils/host";

export default async function aksKaito(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const clusterName = clusterNode.result.name;
    const subscriptionId = clusterNode.result.subscriptionId;
    const resourceGroupName = clusterNode.result.resourceGroupName;

    const panel = new KaitoPanel(extension.result.extensionUri);

    const dataProvider = new KaitoPanelDataProvider(
        clusterName,
        subscriptionId,
        resourceGroupName,
        sessionProvider.result,
    );

    panel.show(dataProvider);
}
