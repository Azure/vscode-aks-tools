import { AcrKey, ClusterKey } from "../../../../../src/webview-contract/webviewDefinitions/connectAcrToCluster";
import { replaceItem, updateValues } from "../../../utilities/array";
import { map as lazyMap, newLoaded, orDefault } from "../../../utilities/lazy";
import { AcrReferenceData, SubscriptionReferenceData } from "../stateTypes";
import * as AcrDataUpdate from "./acrDataUpdate";

export function updateAcrs(data: SubscriptionReferenceData, newKeys: AcrKey[]): SubscriptionReferenceData {
    const existingAcrs = orDefault(data.acrs, []);
    const updatedAcrs = updateValues(
        existingAcrs,
        newKeys,
        (acr, acrData) => acr.resourceGroup === acrData.acr.resourceGroup && acr.acrName === acrData.acr.acrName,
        (acr) => ({
            acr,
            assignedRoleDefinitions: {},
        }),
    );

    return {
        ...data,
        acrs: newLoaded(updatedAcrs),
    };
}

export function setAcrRoleAssignmentLoading(
    data: SubscriptionReferenceData,
    acrKey: AcrKey,
    clusterKey: ClusterKey,
): SubscriptionReferenceData {
    return updateAcr(data, acrKey, (acr) => AcrDataUpdate.setRoleAssignmentLoading(acr, clusterKey));
}

export function updateAcrRoleAssignment(
    data: SubscriptionReferenceData,
    acrKey: AcrKey,
    clusterKey: ClusterKey,
    hasAcrPull: boolean,
): SubscriptionReferenceData {
    return updateAcr(data, acrKey, (acr) => AcrDataUpdate.updateRoleAssignments(acr, clusterKey, hasAcrPull));
}

function updateAcr(
    data: SubscriptionReferenceData,
    acrKey: AcrKey,
    updater: (data: AcrReferenceData) => AcrReferenceData,
): SubscriptionReferenceData {
    return {
        ...data,
        acrs: lazyMap(data.acrs, (acrs) =>
            replaceItem(
                acrs,
                (acrData) =>
                    acrData.acr.resourceGroup === acrKey.resourceGroup && acrData.acr.acrName === acrKey.acrName,
                updater,
            ),
        ),
    };
}
