import { API, CloudExplorerV1 } from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { parseResource } from "../../azure-api-utils";
import * as azcs from '@azure/arm-containerservice';
import { Errorable } from './errorable';
import { ManagedClustersListClusterUserCredentialsResponse } from '@azure/arm-containerservice/esm/models';
import { ResourceManagementClient } from '@azure/arm-resources';
import { SubscriptionTreeNode } from '../../tree/subscriptionTreeItem';

export interface ClusterARMResponse {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly resourceGroup?: string;
    readonly properties: any;
    readonly type: string;
}

export function getAksClusterTreeItem(commandTarget: any, cloudExplorer: API<CloudExplorerV1>): Errorable<AksClusterTreeItem> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: 'Cloud explorer is unavailable.'};
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(commandTarget) as CloudExplorerV1.CloudExplorerResourceNode;

    const isClusterTarget = cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource.nodeType === "cluster";

    if (!isClusterTarget) {
        return { succeeded: false, error: 'This command only applies to AKS clusters.'};
    }

    const cluster = cloudTarget.cloudResource as AksClusterTreeItem;
    if (cluster === undefined) {
        return { succeeded: false, error: 'Cloud target cluster resource is not of type AksClusterTreeItem.'};
    }

    return { succeeded: true, result: cluster };
}

export function getAksClusterSubscriptionItem(commandTarget: any, cloudExplorer: API<CloudExplorerV1>): Errorable<SubscriptionTreeNode> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: 'Cloud explorer is unavailable.'};
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(commandTarget) as CloudExplorerV1.CloudExplorerResourceNode;

    const isAKSSubscriptionTarget = cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource.nodeType === "subscription";

    if (!isAKSSubscriptionTarget) {
        return { succeeded: false, error: 'This command only applies to AKS subscription.'};
    }

    const cloudResource = cloudTarget.cloudResource as SubscriptionTreeNode;
    if (cloudResource === undefined) {
        return { succeeded: false, error: 'Cloud target cluster resource is not of type AksClusterSubscriptionItem.'};
    }

    return { succeeded: true, result: cloudResource };
}

export async function getKubeconfigYaml(target: AksClusterTreeItem): Promise<Errorable<string>> {
    const { resourceGroupName, name } = parseResource(target.id!);
    if (!resourceGroupName || !name) {
        return { succeeded: false, error: `Invalid ARM id ${target.id}`};
    }

    const client = new azcs.ContainerServiceClient(target.root.credentials, target.root.subscriptionId);  // TODO: safely
    let clusterUserCredentials: ManagedClustersListClusterUserCredentialsResponse;
    try {
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(resourceGroupName, name);
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve user credentials for cluster ${name}: ${e}`};
    }

    const kubeconfigCredResult = clusterUserCredentials.kubeconfigs!.find((kubeInfo) => kubeInfo.name === "clusterUser");
    if (kubeconfigCredResult === undefined) {
        return { succeeded: false, error: `No "clusterUser" kubeconfig found for cluster ${name}.`};
    }

    const kubeconfig = kubeconfigCredResult.value?.toString();
    if (kubeconfig === undefined) {
        return { succeeded: false, error: `Empty kubeconfig for cluster ${name}.` }
    }

    return { succeeded: true, result: kubeconfig };
}

export async function getClusterProperties(
    target: AksClusterTreeItem,
    clusterName: string
): Promise<Errorable<ClusterARMResponse>> {
    try {
        const client = new ResourceManagementClient(target.root.credentials, target.root.subscriptionId, { noRetryPolicy: true });
        // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
        const resourceGroupName = target.armId.split("/")[4];
        const clusterInfo = await client.resources.get(resourceGroupName, target.resourceType, "", "", clusterName, "2022-02-01");

        return { succeeded: true, result: <ClusterARMResponse>clusterInfo };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${ex}` };
    }
}
