import * as vscode from "vscode";
import { ReadyAzureSessionProvider } from "../../../../auth/types";
import { ClusterPreference } from "../../types";
import { selectSubscriptions } from "../../../../commands/aksAccount/aksAccount";
import { getClusters, getManagedCluster, getKubeconfigYaml, Cluster } from "../../../../commands/utils/clusters";
import { getFilteredSubscriptions } from "../../../../commands/utils/config";
import { Errorable, failed } from "../../../../commands/utils/errorable";
import { longRunning } from "../../../../commands/utils/host";
import { RecentCluster } from "../state/recentCluster";


export async function selectExistingClusterOption(sessionProvider: ReadyAzureSessionProvider): Promise<Errorable<ClusterPreference>> {
    // allow user to select subscriptions
    await selectSubscriptions();

    // get subscriptions
    const subscriptions = getFilteredSubscriptions();

    // get all clusters in selected subscriptions
    const getClustersPromises = subscriptions.map(o => getClusters(sessionProvider, o.subscriptionId));
    const clusters = (await Promise.all(getClustersPromises)).flatMap(r => r);

    const selectedCluster = await selectCluster(clusters);

    if (selectedCluster === undefined) {
        vscode.window.showWarningMessage(`Cluster not selected.`);
        return { succeeded: false, error: "Cluster not selected." };
    }

    // get cluster properties
    const properties = await longRunning(`Getting properties for cluster ${selectedCluster.cluster.name}.`, () =>
        getManagedCluster(
            sessionProvider,
            selectedCluster.cluster.subscriptionId,
            selectedCluster.cluster.resourceGroup,
            selectedCluster.cluster.name
        ),
    );

    if (failed(properties)) {
        vscode.window.showErrorMessage(properties.error);
        return { succeeded: false, error: properties.error };
    }

    // get kubeconfig yaml
    const kubeconfigYaml = await getKubeconfigYaml(
        sessionProvider,
        selectedCluster.cluster.subscriptionId,
        selectedCluster.cluster.resourceGroup,
        properties.result,
    );

    if (failed(kubeconfigYaml)) {
        return { succeeded: false, error: kubeconfigYaml.error };
    }

    const cluster: ClusterPreference = {
        subscriptionId: selectedCluster.cluster.subscriptionId,
        clusterName: selectedCluster.cluster.name,
        clusterId: properties.result.id,
        resourceGroup: selectedCluster.cluster.resourceGroup,
        kubeConfigYAML: kubeconfigYaml.result,
    };

    // save selected cluster as recently used cluster
    const saved = await RecentCluster.saveRecentCluster(cluster);

    if(failed(saved)) {
        // no need to throw error 
        vscode.window.showErrorMessage(saved.error);
    }

    return { succeeded: true, result: cluster };
}

type ClusterQuickPickItem = vscode.QuickPickItem & { cluster: Cluster };
async function selectCluster(clusters: Cluster[]): Promise<ClusterQuickPickItem | undefined> {

    const quickPickItems: ClusterQuickPickItem[] = clusters.map((cluster) => {
        return {
            label: cluster.name || "",
            description: cluster.clusterId,
            cluster: {
                clusterId: cluster.clusterId,
                name: cluster.name,
                resourceGroup: cluster.resourceGroup,
                subscriptionId: cluster.subscriptionId
            }
        };
    });

    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false,
        placeHolder: "Select Cluster",
    });

    if (!selectedItem) {
        return undefined;
    }

    return selectedItem;
}