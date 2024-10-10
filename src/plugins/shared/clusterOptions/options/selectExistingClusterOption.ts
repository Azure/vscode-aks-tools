import * as vscode from "vscode";
import { ReadyAzureSessionProvider } from "../../../../auth/types";
import { ClusterPreference } from "../../types";
import { selectSubscriptions } from "../../../../commands/aksAccount/aksAccount";
import { getClusters, getManagedCluster, getKubeconfigYaml, Cluster } from "../../../../commands/utils/clusters";
import { getFilteredSubscriptions } from "../../../../commands/utils/config";
import { Errorable, failed } from "../../../../commands/utils/errorable";
import { longRunning } from "../../../../commands/utils/host";
import { RecentCluster } from "../state/recentCluster";
import { handleNoSubscriptionsFound } from "../../../../commands/utils/subscriptions";

export async function selectExistingClusterOption(
    sessionProvider: ReadyAzureSessionProvider,
): Promise<Errorable<ClusterPreference>> {
    await selectSubscriptions();

    const subscriptions = getFilteredSubscriptions();
    if(subscriptions.length === 0) { 
        handleNoSubscriptionsFound();
        return { succeeded: false, error: "No subscriptions found." };
    }

    const clusters = (
        await Promise.all(subscriptions.map((sub) => getClusters(sessionProvider, sub.subscriptionId)))
    ).flat();

    if(clusters.length === 0) {
        handleNoClusterFound();
        return { succeeded: false, error: "No clusters found." };
    }

    const selectedCluster = await selectCluster(clusters);
    if (!selectedCluster) {
        vscode.window.showWarningMessage("Cluster not selected.");
        return { succeeded: false, error: "Cluster not selected." };
    }

    const { subscriptionId, resourceGroup, name } = selectedCluster.cluster;
    const properties = await longRunning(`Getting properties for cluster ${name}.`, () =>
        getManagedCluster(sessionProvider, subscriptionId, resourceGroup, name),
    );

    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return { succeeded: false, error: properties.error };
    }

    const kubeconfigYaml = await getKubeconfigYaml(sessionProvider, subscriptionId, resourceGroup, properties.result);
    if (failed(kubeconfigYaml)) {
        return { succeeded: false, error: kubeconfigYaml.error };
    }

    const cluster: ClusterPreference = {
        subscriptionId,
        clusterName: name,
        clusterId: properties.result.id,
        resourceGroup,
        kubeConfigYAML: kubeconfigYaml.result,
    };

    const saved = await RecentCluster.saveRecentCluster(cluster);
    if (failed(saved)) {
        vscode.window.showErrorMessage(saved.error);
    }

    return { succeeded: true, result: cluster };
}

type ClusterQuickPickItem = vscode.QuickPickItem & { cluster: Cluster };

async function selectCluster(clusters: Cluster[]): Promise<ClusterQuickPickItem | undefined> {
    const quickPickItems = clusters.map<ClusterQuickPickItem>((cluster) => ({
        label: cluster.name || "",
        description: cluster.clusterId,
        cluster: { ...cluster }, // Spread the cluster object for brevity
    }));

    return await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select Cluster",
    });
}

export function handleNoClusterFound(): void {
    const noClustersFound = "No clusters were found."
    const createCluster = "Create an AKS cluster";
    vscode.window.showInformationMessage(noClustersFound, createCluster).then((res) => {
        if(res === createCluster) {
            vscode.commands.executeCommand("aks.aksCreateClusterFromCopilot");
        }
    });
}