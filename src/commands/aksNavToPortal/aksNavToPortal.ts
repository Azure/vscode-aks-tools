import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeNode } from "../utils/clusters";
import { getExtensionPath } from "../utils/host";
import { failed } from "../utils/errorable";
import { getPortalResourceUrl } from "../utils/env";

export default async function aksNavToPortal(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return;
    }

    // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
    const resourceUrl = getPortalResourceUrl(clusterNode.result.subscription.environment, clusterNode.result.armId);
    vscode.env.openExternal(vscode.Uri.parse(resourceUrl));
}
