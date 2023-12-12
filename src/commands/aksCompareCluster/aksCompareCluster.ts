import { QuickPickItem } from 'vscode';
import { createQuickPickStep, runMultiStepInput } from '../utils/multiStepHelper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClient, getResourceManagementClient, } from '../utils/clusters';
import { failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { getExtension } from '../utils/host';
import { Dictionary } from '../utils/dictionary';
import * as tmpfile from "../utils/tempfile";
import { longRunning } from "../utils/host";

interface State {
    clusterGroupCompareFrom: ClusterNameItem;
    clusterGroupCompareWith: ClusterNameItem;
    clustername: string;
    subid: string | undefined;
}

interface ClusterNameItem extends QuickPickItem {
    name: string;
}

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCompareCluster(
    _context: IActionContext,
    target: unknown
): Promise<void> {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterSubscriptionItem(target, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }
    const subscriptionTreeItem = <SubscriptionTreeItem>cluster.result;

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }
    const containerServiceClient = getContainerClient(subscriptionTreeItem);
    const clusterList: string[] = [];
    const clusterResourceDictionary: Dictionary<string> = {};

    await longRunning(`Getting AKS Cluster list for ${subscriptionTreeItem.name}`, async () => {
        const iterator = containerServiceClient.managedClusters.list();
        for await (const clusters of iterator.byPage()) {
            const validClusters = clusters.filter(c => c.id && c.name);
            clusterList.push(...validClusters.map(c => c.name!));
            validClusters.forEach(c => {
                clusterResourceDictionary[c.name!] = c.id!;
            });
        }
       
    });

    // Pick a cluster from group to compare with
    const clusterGroupCompareWithStep = createQuickPickStep<State, ClusterNameItem>({
        placeholder: 'Pick a cluster from group to compare with',
        shouldResume: () => Promise.resolve(false),
        items: clusterList.map(name => ({ label: name, name })),
        getActiveItem: state => state.clusterGroupCompareWith,
        storeItem: (state, item) => ({ ...state, clusterGroupCompareWith: item })
    });

    // Pick a cluster from group to compare from
    const clusterGroupCompareFromStep = createQuickPickStep<State, ClusterNameItem>({
        placeholder: 'Pick second cluster from group to compare from',
        shouldResume: () => Promise.resolve(false),
        items: clusterList.map(name => ({ label: name, name })),
        getActiveItem: state => state.clusterGroupCompareFrom,
        storeItem: (state, item) => ({ ...state, clusterGroupCompareFrom: item })
    });

    const initialState: Partial<State> = {
        subid: cluster.result.subscription.subscriptionId
    };

    const state = await runMultiStepInput('Compare AKS Cluster', initialState, clusterGroupCompareWithStep, clusterGroupCompareFromStep);
    if (!state) {
        // Cancelled
        return;
    }

    // Call compare cluster at this instance
    await compareManagedCluster(state, clusterResourceDictionary, subscriptionTreeItem)

}


async function compareManagedCluster(state: State, clusterResourceDictionary: Dictionary<string>, subscription: SubscriptionTreeItem) {

    await longRunning(`Comparing AKS Cluster ${state.clusterGroupCompareWith.name} with ${state.clusterGroupCompareFrom.name}`, async () => {

        const resourceManagementClient = getResourceManagementClient(subscription);

        const resourceArmIDWith = clusterResourceDictionary[state.clusterGroupCompareWith.name];
        const resourceArmIDFrom = clusterResourceDictionary[state.clusterGroupCompareFrom.name];
        // Example: GET https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/{resourceName}?api-version=2023-08-01
        // source of example: https://learn.microsoft.com/en-us/rest/api/aks/managed-clusters/get?view=rest-aks-2023-08-01&tabs=HTTP#code-try-0 
        const clusterWithContent = await resourceManagementClient.resources.getById(resourceArmIDWith, "2023-08-01");
        // await resourceManagementClient.sendRequest({ method: 'GET', path: resourceArmIDWith } as PipelineRequest);
        const clusterFromContent = await resourceManagementClient.resources.getById(resourceArmIDFrom, "2023-08-01");

        const clusterCompareWithFile = await tmpfile.createTempFile(JSON.stringify(clusterWithContent, null, '\t'), "json");
        const clusterCompareFromFile = await tmpfile.createTempFile(JSON.stringify(clusterFromContent, null, '\t'), "json");

        vscode.commands.executeCommand("vscode.diff"
            , vscode.Uri.file(`${clusterCompareWithFile.filePath}`)
            , vscode.Uri.file(`${clusterCompareFromFile.filePath}`));
    });
}

