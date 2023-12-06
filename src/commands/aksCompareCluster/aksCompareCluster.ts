import { QuickPickItem } from 'vscode';
import { createQuickPickStep, runMultiStepInput } from '../utils/multiStepHelper';
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClient, } from '../utils/clusters';
import { failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { getExtension } from '../utils/host';

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
    for await (const cluster of iterator.byPage()) {
        clusterList.push(...cluster.map(c => c.name ?? ''));
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
    // createManagedClusterWithOssku(state, <SubscriptionTreeItem>cluster.result);
}
