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
    const iterator = containerServiceClient.managedClusters.list();
    const clusterGroupList: Dictionary<string> = {};
    for await (const cluster of iterator.byPage()) {
        clusterList.push(...cluster.map(c => c.name ?? ''));
        cluster.map((c) => {
            const resourceId = c.id!;
            const clusterName = c.name!;
            if (resourceId && clusterName) {
                clusterGroupList[clusterName] = resourceId;
            }
        });
    }


    const clusterGroupCompareWithStep = createQuickPickStep<State, ClusterNameItem>({
        placeholder: 'Pick a cluster from group to compare with',
        shouldResume: () => Promise.resolve(false),
        items: clusterList.map(name => ({ label: name, name })),
        getActiveItem: state => state.clusterGroupCompareWith,
        storeItem: (state, item) => ({ ...state, clusterGroupCompareWith: item })
    });

    const clusterGroupCompareFromStep = createQuickPickStep<State, ClusterNameItem>({
        placeholder: 'Pick a cluster from group to compare with',
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

    // Call create cluster at this instance
    await compareManagedCluster(state, clusterGroupList, <SubscriptionTreeItem>cluster.result);
}


async function compareManagedCluster(state: State, clusterResourceDictionary: Dictionary<string>, subscription: SubscriptionTreeItem) {

    const resourceManagementClient = getResourceManagementClient(subscription);

    const resourceArmIDWith = clusterResourceDictionary[state.clusterGroupCompareWith.name];
    const resourceArmIDFrom = clusterResourceDictionary[state.clusterGroupCompareFrom.name];
    const clusterWith = "";
    // Example: GET https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/{resourceName}?api-version=2023-08-01
    // source of example: https://learn.microsoft.com/en-us/rest/api/aks/managed-clusters/get?view=rest-aks-2023-08-01&tabs=HTTP#code-try-0 
    const clusterWithContent = await resourceManagementClient.resources.getById(resourceArmIDWith, "2023-08-01");
    // await resourceManagementClient.sendRequest({ method: 'GET', path: resourceArmIDWith } as PipelineRequest);
    const clusterFromContent = await resourceManagementClient.resources.getById(resourceArmIDFrom, "2023-08-01");

    console.log(clusterWith);
    const file1 = await tmpfile.createTempFile(JSON.stringify(clusterWithContent, null, '\t'), "json");
    const file2 = await tmpfile.createTempFile(JSON.stringify(clusterFromContent, null, '\t'), "json");

    vscode.commands.executeCommand("vscode.diff"
        , vscode.Uri.file(`${file1.filePath}`)
        , vscode.Uri.file(`${file2.filePath}`))
}

