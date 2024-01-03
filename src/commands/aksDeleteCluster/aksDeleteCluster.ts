import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { deleteCluster, getAksClusterTreeNode } from "../utils/clusters";
import { failed, succeeded } from "../utils/errorable";
import { longRunning } from "../utils/host";

const refreshIntervals = [1, 2, 5, 10, 30, 60, 120];

export default async function aksDeleteCluster(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const clusterNode = getAksClusterTreeNode(target, cloudExplorer);
    if (failed(clusterNode)) {
        vscode.window.showErrorMessage(clusterNode.error);
        return;
    }

    const clusterName = clusterNode.result.name;

    const answer = await vscode.window.showInformationMessage(
        `Do you want to delete cluster ${clusterName}?`,
        "Yes",
        "No",
    );

    if (answer === "Yes") {
        const result = await longRunning(`Deleting cluster ${clusterName}.`, async () => {
            return await deleteCluster(clusterNode.result, clusterName);
        });

        if (failed(result)) {
            vscode.window.showErrorMessage(result.error);
        }

        if (succeeded(result)) {
            vscode.window.showInformationMessage(result.result);

            // Periodically refresh the subscription treeview, because the list-clusters API
            // call still includes the cluster for a while after it's been deleted.
            refreshIntervals.forEach((interval) => {
                setTimeout(() => {
                    vscode.commands.executeCommand("aks.refreshSubscription", clusterNode.result.subscriptionTreeNode);
                }, interval * 1000);
            });
        }
    }
}
