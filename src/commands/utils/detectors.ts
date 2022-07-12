import { ResourceManagementClient } from "@azure/arm-resources";
import { Errorable, combine, failed } from "./errorable";
import AksClusterTreeItem from '../../tree/aksClusterTreeItem';
const meta = require('../../../package.json');

export interface AppLensARMResponse {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly resourceGroup?: string;
    readonly properties: any;
    readonly type: string;
}

export async function getDetectorListData(
    cloudTarget: AksClusterTreeItem,
    clusterAppLensData: AppLensARMResponse
): Promise<Errorable<Map<string, AppLensARMResponse>>> {

    // Crud detector list is guranteed form the ARM call to aks-category-crud, under below data structure.
    const crudDetectorList: string[] = clusterAppLensData?.properties.dataset[0].renderingProperties.detectorIds;
    if (crudDetectorList.length === 0) {
        return { succeeded: false, error: `No detectors found in AppLens response for ${clusterAppLensData.name}` };
    }

    let results: Errorable<AppLensARMResponse>[] = [];
    try {
        const promiseResults = await Promise.all(crudDetectorList.map((detector) => getDetectorInfo(cloudTarget, detector)));
        // Line below is added to handle edge case of applens detector list with missing implementation,
        // due to internal server error it causes rest of list to fail.
        results = promiseResults.filter((x) => x.succeeded);
    } catch (err) {
        // This would be unexpected even in the event of network failure, because the individual promises handle
        // their own errors.
        return { succeeded: false, error: `Failed to retrieve detector data for ${clusterAppLensData.name}` };
    }

    const responses = combine(results);
    if (failed(responses)) {
        return { succeeded: false, error: responses.error };
    }

    const detectorMap = new Map(responses.result.map((r, i) => [crudDetectorList[i], r]));
    return { succeeded: true, result: detectorMap };
}

export async function getDetectorInfo(
    target: AksClusterTreeItem,
    detectorName: string
): Promise<Errorable<AppLensARMResponse>> {
    try {
        const client = new ResourceManagementClient(target.subscription.credentials, target.subscription.subscriptionId, { noRetryPolicy: true });
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

export function getPortalUrl(clusterdata: AppLensARMResponse) {
    return `https://portal.azure.com/#resource${clusterdata.id.split('detectors')[0]}aksDiagnostics?referrer_source=vscode&referrer_context=${meta.name}`;
}
