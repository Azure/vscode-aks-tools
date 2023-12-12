import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem } from "../utils/clusters";
import { getExtensionPath } from "../utils/host";
import { failed } from "../utils/errorable";
import { getPortalResourceUrl } from "../utils/env";

export default async function aksNavToPortal(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    const extensionPath = getExtensionPath();
    if (failed(extensionPath)) {
        vscode.window.showErrorMessage(extensionPath.error);
        return;
    }

    // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
    const resourceUrl = getPortalResourceUrl(cluster.result.subscription.environment, cluster.result.armId);
    vscode.env.openExternal(vscode.Uri.parse(resourceUrl));
}
