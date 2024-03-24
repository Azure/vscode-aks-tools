import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { reconcileUsingUpdateInCluster, getAksClusterTreeNode } from "../utils/clusters";
import { failed, succeeded } from "../utils/errorable";
import { longRunning } from "../utils/host";

export default async function aksReconcileCluster(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const clusterName = clusterNode.result.name;

    const answer = await vscode.window.showInformationMessage(
        `Do you want to reconcile/update operation on cluster ${clusterName}?`,
        "Yes",
        "No",
    );

    if (answer === "Yes") {
        const result = await longRunning(`Reconciling/update last cluster operation in ${clusterName}.`, async () => {
            return await reconcileUsingUpdateInCluster(
                clusterNode.result.subscriptionId,
                clusterNode.result.resourceGroupName,
                clusterName,
            );
        });

        if (failed(result)) {
            vscode.window.showErrorMessage(result.error);
        }

        if (succeeded(result)) {
            vscode.window.showInformationMessage(result.result);
        }
    }
}
