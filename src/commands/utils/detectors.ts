import { Errorable, combine, failed, getErrorMessage } from "./errorable";
import { AksClusterTreeNode } from "../../tree/aksClusterTreeItem";
import * as fs from "fs";
import * as path from "path";
import {
    ARMResponse,
    CategoryDetectorARMResponse,
    SingleDetectorARMResponse,
    isCategoryDataset,
} from "../../webview-contract/webviewDefinitions/detector";
import { getResourceManagementClient } from "./clusters";
import { dirSync } from "tmp";
import { Environment } from "@azure/ms-rest-azure-env";
import { getPortalResourceUrl } from "./env";

/**
 * Can be used to store the JSON responses for a collection of category detectors and all their child detectors.
 */
export async function saveAllDetectorResponses(clusterNode: AksClusterTreeNode, categoryDetectorIds: string[]) {
    const outputDirObj = dirSync();

    for (const categoryDetectorId of categoryDetectorIds) {
        const categoryDetector = await getDetectorInfo(clusterNode, categoryDetectorId);
        if (failed(categoryDetector)) {
            throw new Error(
                `Error getting category detector ${categoryDetectorId}: ${getErrorMessage(categoryDetector.error)}`,
            );
        }

        saveDetector(outputDirObj.name, categoryDetector.result);

        const singleDetectors = await getDetectorListData(clusterNode, categoryDetector.result);
        if (failed(singleDetectors)) {
            throw new Error(
                `Error getting single detectors for ${categoryDetectorId}: ${getErrorMessage(singleDetectors.error)}`,
            );
        }

        for (const singleDetector of singleDetectors.result) {
            saveDetector(outputDirObj.name, singleDetector);
        }
    }
}

function saveDetector(outputDir: string, detector: CategoryDetectorARMResponse | SingleDetectorARMResponse) {
    const detectorFilePath = path.join(outputDir, `${detector.name}.json`);
    // Anonymize the data.
    detector.id = `/subscriptions/12345678-1234-1234-1234-1234567890ab/resourcegroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/detectors/${detector.name}`;
    fs.writeFileSync(detectorFilePath, JSON.stringify(detector, null, 2));
}

export async function getDetectorListData(
    clusterNode: AksClusterTreeNode,
    categoryDetector: CategoryDetectorARMResponse,
): Promise<Errorable<SingleDetectorARMResponse[]>> {
    const detectorIds =
        categoryDetector.properties.dataset.filter(isCategoryDataset)[0].renderingProperties.detectorIds;
    if (detectorIds.length === 0) {
        return { succeeded: false, error: `No detectors found in AppLens response for ${categoryDetector.name}` };
    }

    let results: Errorable<SingleDetectorARMResponse>[] = [];
    try {
        const promiseResults = await Promise.all(detectorIds.map((name) => getDetectorInfo(clusterNode, name)));
        // Line below is added to handle edge case of applens detector list with missing implementation,
        // due to internal server error it causes rest of list to fail.
        results = promiseResults.filter((x) => x.succeeded);
    } catch (err) {
        // This would be unexpected even in the event of network failure, because the individual promises handle
        // their own errors.
        return { succeeded: false, error: `Failed to retrieve detector data for ${categoryDetector.name}` };
    }

    return combine(results);
}

export async function getDetectorInfo(
    clusterNode: AksClusterTreeNode,
    detectorName: string,
): Promise<Errorable<CategoryDetectorARMResponse>> {
    try {
        const client = getResourceManagementClient(clusterNode);
        const detectorInfo = await client.resources.get(
            clusterNode.resourceGroupName,
            clusterNode.resourceType,
            clusterNode.name,
            "detectors",
            detectorName,
            "2019-08-01",
        );

        return { succeeded: true, result: <CategoryDetectorARMResponse>detectorInfo };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${detectorName} detector: ${ex}` };
    }
}

export function getPortalUrl(environment: Environment, clusterdata: ARMResponse<unknown>) {
    const armId = `${clusterdata.id.split("detectors")[0]}aksDiagnostics`;
    return getPortalResourceUrl(environment, armId);
}
