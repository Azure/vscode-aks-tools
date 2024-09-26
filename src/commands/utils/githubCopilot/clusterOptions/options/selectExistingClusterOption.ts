import * as vscode from "vscode";
import { ReadyAzureSessionProvider } from "../../../../../auth/types";
import { ClusterPreference } from "../../../../../plugins/shared/types";
import { selectSubscriptions } from "../../../../aksAccount/aksAccount";
import { getClusters, getManagedCluster, getKubeconfigYaml, Cluster } from "../../../clusters";
import { getFilteredSubscriptions } from "../../../config";
import { Errorable, failed } from "../../../errorable";
import { longRunning } from "../../../host";
import { DefaultClusterTemp } from "../../state/defaultClusterTemp";


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

    // save selected cluster as default
    const saved = await DefaultClusterTemp.saveDefaultCluster(cluster);

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