import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterQuickPickItem, getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { longRunning } from "../utils/host";
import { ManagedCluster } from "@azure/arm-containerservice";
import { getAksClient } from "../utils/arm";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { getFilteredClusters, setFilteredClusters } from "./config";
import { parseResource, parseSubId } from "../../azure-api-utils";

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

    const containerServiceClient = getAksClient(sessionProvider.result, subscriptionNode.result.subscriptionId);
    const clusterList: ManagedCluster[] = [];

    await longRunning(`Getting AKS Cluster list for ${subscriptionNode.result.name}`, async () => {
        const iterator = containerServiceClient.managedClusters.list();
        for await (const clusters of iterator.byPage()) {
            const validClusters = clusters.filter((c) => c.id && c.name);
            clusterList.push(
                ...validClusters.map((c) => ({ label: c.name!, name: c.name!, id: c.id!, location: c.location! })),
            );
        }
    });

    const filteredClusters = await getUniqueClusters();

    const quickPickItems: ClusterQuickPickItem[] = clusterList.map((cluster) => {
        return {
            label: cluster.name || "",
            description: cluster.name,
            picked: filteredClusters.some((filtered) => filtered.clusterName === parseResource(cluster.id!).name), // filtered.subscriptionId === parseSubId(cluster.id!).subId),
            Cluster: {
                clusterName: cluster.name || "",
                subscriptionId: parseSubId(cluster.id!).subId || "",
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
