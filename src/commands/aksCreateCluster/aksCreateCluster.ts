import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterSubscriptionItem, getContainerClient, getResourceManagementClient } from '../utils/clusters';
import { failed } from '../utils/errorable';
import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import SubscriptionTreeItem from '../../tree/subscriptionTreeItem';
import { getExtension } from '../utils/host';
import { CreateClusterDataProvider, CreateClusterPanel } from '../../panels/CreateClusterPanel';

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(
    _context: IActionContext,
    target: any
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

    const panel = new CreateClusterPanel(extension.result.extensionUri);

    const resourceManagementClient = getResourceManagementClient(subscriptionTreeItem);
    const containerServiceClient = getContainerClient(subscriptionTreeItem);
    const portalUrl = subscriptionTreeItem.subscription.environment.portalUrl;
    const dataProvider = new CreateClusterDataProvider(
        resourceManagementClient,
        containerServiceClient,
        portalUrl,
        subscriptionTreeItem.subscription.subscriptionId,
        subscriptionTreeItem.subscription.subscriptionDisplayName);

    panel.show(dataProvider);
}
