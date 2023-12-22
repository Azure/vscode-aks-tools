import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeNode, getContainerClient } from "../utils/clusters";
import { getExtension } from "../utils/host";
import { failed } from "../utils/errorable";
import { ClusterPropertiesDataProvider, ClusterPropertiesPanel } from "../../panels/ClusterPropertiesPanel";

export default async function aksClusterProperties(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

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

    const client = getContainerClient(clusterNode.result);
    const dataProvider = new ClusterPropertiesDataProvider(
        client,
        clusterNode.result.resourceGroupName,
        clusterNode.result.name,
    );
    const panel = new ClusterPropertiesPanel(extension.result.extensionUri);

    panel.show(dataProvider);
}
