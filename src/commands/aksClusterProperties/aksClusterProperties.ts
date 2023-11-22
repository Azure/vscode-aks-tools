import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem, getContainerClient } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import { ClusterPropertiesDataProvider, ClusterPropertiesPanel } from "../../panels/ClusterPropertiesPanel";

export default async function aksClusterProperties(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const client = getContainerClient(cluster.result);
    const dataProvider = new ClusterPropertiesDataProvider(
        client,
        cluster.result.resourceGroupName,
        cluster.result.name,
    );
    const panel = new ClusterPropertiesPanel(extension.result.extensionUri);

    panel.show(dataProvider);
}
