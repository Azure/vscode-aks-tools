import * as vscode from 'vscode';
import { API, CloudExplorerV1 } from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { parseResource } from "../../azure-api-utils";
import * as azcs from '@azure/arm-containerservice';

export function getAksClusterTreeItem(commandTarget: any, cloudExplorer: API<CloudExplorerV1>): AksClusterTreeItem | undefined {
    if (!cloudExplorer.available) {
        vscode.window.showWarningMessage('Cloud explorer is unavailable.');
        return undefined;
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(commandTarget) as CloudExplorerV1.CloudExplorerResourceNode;

    const isClusterTarget = cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource.nodeType === "cluster";

    if (!isClusterTarget) {
        vscode.window.showInformationMessage('This command only applies to AKS clusters.');
        return undefined;
    }

    const cluster = cloudTarget.cloudResource as AksClusterTreeItem;
    if (cluster === undefined) {
        vscode.window.showErrorMessage('Cloud target cluster resource is not of type AksClusterTreeItem');
        return undefined;
    }

    return cluster;
}

export async function getKubeconfigYaml(target: AksClusterTreeItem): Promise<string | undefined> {
    const { resourceGroupName, name } = parseResource(target.id!);
    if (!resourceGroupName || !name) {
        vscode.window.showErrorMessage(`Invalid ARM id ${target.id}`);
        return undefined;
    }
    const client = new azcs.ContainerServiceClient(target.root.credentials, target.root.subscriptionId);  // TODO: safely
    try {
        const clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(resourceGroupName, name);
        const kubeconfigCredResult = clusterUserCredentials.kubeconfigs!.find((kubeInfo) => kubeInfo.name === "clusterUser");
        const kubeconfig = kubeconfigCredResult?.value?.toString();
        return kubeconfig;
    } catch (e) {
        vscode.window.showErrorMessage(`Can't get kubeconfig: ${e}`);
        return undefined;
    }
}