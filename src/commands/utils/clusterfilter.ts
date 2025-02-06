import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterQuickPickItem, getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { longRunning } from "../utils/host";
import { getGraphResourceClient } from "../utils/arm";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { AksCluster, getFilteredClusters, setFilteredClusters } from "./config";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

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

    const graphServiceClient = getGraphResourceClient(sessionProvider.result);
    let clusterList: AksCluster[];

    await longRunning(`Getting AKS Cluster list for ${subscriptionNode.result.name}`, async () => {
        const aksClusters = await fetchAksClusters(graphServiceClient, subscriptionNode.result.subscriptionId);
        clusterList = aksClusters;
    });

    const filteredClusters = await getUniqueClusters();

    const quickPickItems: ClusterQuickPickItem[] = clusterList!.map((cluster: AksCluster) => {
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

async function fetchAksClusters(
    graphServiceClient: ResourceGraphClient,
    subscriptionId: string,
): Promise<AksCluster[]> {
    const query = {
        query: "Resources | where type =~ 'Microsoft.ContainerService/managedClusters' | project id, name, location, resourceGroup, subscriptionId, type",
        subscriptions: [subscriptionId],
    };

    try {
        const response = await graphServiceClient.resources(query);

        const aksClusters: AksCluster[] = response.data.map((resource: AksCluster) => ({
            id: resource.id,
            name: resource.name,
            location: resource.location,
            resourceGroup: resource.resourceGroup,
            subscriptionId: resource.subscriptionId,
            type: resource.type,
        }));

        return aksClusters;
    } catch (error) {
        console.error("Error fetching AKS clusters:", error);
        return [];
    }
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
