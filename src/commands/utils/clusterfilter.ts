import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterQuickPickItem, getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { longRunning } from "../utils/host";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { AksClusterAndFleet, getFilteredClusters, setFilteredClusters } from "./config";
import { getClusterAndFleetResourcesFromGraphAPI } from "./azureResources";

export default async function aksClusterFilter(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
    if (failed(subscriptionNode)) {
        vscode.window.showErrorMessage(subscriptionNode.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    let clusterList: AksClusterAndFleet[] = [];

    await longRunning(`Getting AKS Cluster list for ${subscriptionNode.result.name}`, async () => {
        const aksClusters = await getClusterAndFleetResourcesFromGraphAPI(sessionProvider.result, subscriptionNode.result.subscriptionId);
        if (failed(aksClusters)) {
            vscode.window.showErrorMessage(aksClusters.error);
            return;
        }
        clusterList = aksClusters.result;
    });

    const filteredClusters = await getUniqueClusters();

    const quickPickItems: ClusterQuickPickItem[] = clusterList.map((cluster: AksClusterAndFleet) => {
        return {
            label: cluster.name || "",
            description: cluster.name,
            picked: filteredClusters.some((filtered) => filtered.clusterName === cluster.name),
            Cluster: {
                clusterName: cluster.name || "",
                subscriptionId: cluster.subscriptionId || "",
            },
        };
    });

    // show picked items at the top
    quickPickItems.sort((itemA, itemB) => (itemA.picked === itemB.picked ? 0 : itemA.picked ? -1 : 1));

    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: true,
        placeHolder: "Select Cluster",
    });

    if (!selectedItems) {
        return;
    }

    // Set Cluster Instance
    const newFilteredClusters = [
        ...selectedItems.map((item) => item.Cluster), // Retain filters in any other tenants.
    ];

    await setFilteredClusters(newFilteredClusters);
}

async function getUniqueClusters() {
    const filteredClusters = getFilteredClusters();

    if (filteredClusters && Array.isArray(filteredClusters)) {
        // Use a Map to remove duplicates based on subid and ClusterName
        const uniqueClusters = Array.from(
            new Map(filteredClusters.map((item) => [`${item.subscriptionId}-${item.clusterName}`, item])).values(),
        );

        return uniqueClusters;
    }

    return [];
}
