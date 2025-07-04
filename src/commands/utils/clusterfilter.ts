import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ClusterQuickPickItem, getAksClusterSubscriptionNode } from "../utils/clusters";
import { failed, Errorable } from "../utils/errorable";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { getExtension } from "../utils/host";
import { longRunning } from "../utils/host";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { AksClusterAndFleet, getFilteredClusters, setFilteredClusters } from "./config";
import { clusterResourceType, getClusterAndFleetResourcesFromGraphAPI } from "./azureResources";
import { ReadyAzureSessionProvider } from "../../auth/types";

export default async function aksClusterFilter(_context: IActionContext, target: unknown): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const subscriptionNode = getAksClusterSubscriptionNode(target, cloudExplorer);
    if (failed(subscriptionNode)) {
        vscode.window.showErrorMessage(subscriptionNode.error);
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        vscode.window.showErrorMessage(sessionProvider.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const filteredClusters = await getUniqueClusters();

    const clusterList = await getClusterList(
        subscriptionNode.result.name,
        subscriptionNode.result.subscriptionId,
        sessionProvider.result,
    );
    if (failed(clusterList)) {
        vscode.window.showErrorMessage(clusterList.error);
        return;
    }

    const quickPickItems: ClusterQuickPickItem[] = clusterList.result.map((cluster: AksClusterAndFleet) => {
        return {
            label: cluster.name,
            description: cluster.name,
            picked: filteredClusters.some(
                (filtered) =>
                    filtered.clusterName === cluster.name && filtered.subscriptionId === cluster.subscriptionId,
            ),
            Cluster: {
                clusterName: cluster.name,
                subscriptionId: cluster.subscriptionId,
            },
        };
    });

    // show picked items at the top
    quickPickItems.sort((itemA, itemB) => (itemA.picked === itemB.picked ? 0 : itemA.picked ? -1 : 1));

    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: true,
        placeHolder: "Select Cluster",
    });

    // Set Cluster Instance
    const newFilteredClusters = selectedItems
        ? [
              ...selectedItems.map((item) => item.Cluster), // Retain filters in any other tenants.
          ]
        : [];

    await setFilteredClusters(newFilteredClusters, clusterList.result);
}

export async function addItemToClusterFilter(
    subscriptionName: string,
    subscriptionId: string,
    clusterName: string,
    sessionProvider: ReadyAzureSessionProvider,
) {
    const clusterList = await getClusterList(subscriptionName, subscriptionId, sessionProvider);
    if (failed(clusterList)) {
        vscode.window.showErrorMessage(clusterList.error);
        return;
    } else {
        const filteredClusters = await getUniqueClusters();
        filteredClusters.push({ clusterName, subscriptionId });
        await setFilteredClusters(filteredClusters, clusterList.result);
    }
}

export async function getClusterList(
    subscriptionName: string,
    subscriptionId: string,
    sessionProvider: ReadyAzureSessionProvider,
): Promise<Errorable<AksClusterAndFleet[]>> {
    // Long running that captures errors that necessitate a return out of the function
    const clusterListResult = await longRunning(
        `Getting AKS Cluster list for ${subscriptionName}`,
        async (): Promise<Errorable<AksClusterAndFleet[]>> => {
            let clusterList: AksClusterAndFleet[] = [];
            const aksClusters = await getClusterAndFleetResourcesFromGraphAPI(sessionProvider, subscriptionId);
            if (failed(aksClusters)) {
                return { succeeded: false, error: aksClusters.error };
            }
            clusterList = aksClusters.result.filter(
                // only keep clusters for the cluster filter (remove fleets from the list)
                (r) => r.type.toLowerCase() === clusterResourceType.toLowerCase(),
            );
            return { succeeded: true, result: clusterList };
        },
    );

    if (failed(clusterListResult)) {
        return { succeeded: false, error: clusterListResult.error };
    }
    return { succeeded: true, result: clusterListResult.result };
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
