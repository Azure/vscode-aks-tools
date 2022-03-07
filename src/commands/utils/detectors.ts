import * as vscode from 'vscode';
import { ResourceManagementClient } from "@azure/arm-resources";
import { AppLensARMResponse } from "../detectorDiagnostics/models/applensarmresponse";
import { Errorable } from "./errorable";

export async function getAppLensDetectorData(
    clusterTarget: any,
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
    target: any,
    detectorName: string
): Promise<Errorable<AppLensARMResponse>> {
    try {
        const client = new ResourceManagementClient(target.root.credentials, target.root.subscriptionId);
        // armid is in the format: /subscriptions/<sub_id>/resourceGroups/<resource_group>/providers/<container_service>/managedClusters/<aks_clustername>
        const resourceGroup = target.armId.split("/")[4];
        const detectorInfo = await client.resources.get(
            resourceGroup, target.resource.type,
            target.resource.name, "detectors", detectorName, "2019-08-01");

        return { succeeded: true, result: <AppLensARMResponse>detectorInfo };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${detectorName} detector: ${ex}` };
    }
}
