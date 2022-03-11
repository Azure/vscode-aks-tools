import * as vscode from 'vscode';
import { ResourceManagementClient } from "@azure/arm-resources";
import { Errorable } from "./errorable";
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';

export interface AppLensARMResponse {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly resourceGroup?: string;
    readonly properties: any;
    readonly type: string;
}

export async function getAppLensDetectorData(
    clusterTarget: AksClusterTreeItem,
    detectorName: string
): Promise<AppLensARMResponse | undefined> {
    const apiResult = await getDetectorInfo(clusterTarget, detectorName);

    if (apiResult.succeeded) {
        return apiResult.result;
    } else {
        vscode.window.showInformationMessage(apiResult.error);
    }
    return undefined;
}

async function getDetectorInfo(
    target: AksClusterTreeItem,
    detectorName: string
): Promise<Errorable<AppLensARMResponse>> {
    try {
        const client = new ResourceManagementClient(target.root.credentials, target.root.subscriptionId);
        // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
        const resourceGroup = target.armId.split("/")[4];
        const detectorInfo = await client.resources.get(
            resourceGroup, target.resourceType,
            target.name, "detectors", detectorName, "2019-08-01");

        return { succeeded: true, result: <AppLensARMResponse>detectorInfo };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${detectorName} detector: ${ex}` };
    }
}
