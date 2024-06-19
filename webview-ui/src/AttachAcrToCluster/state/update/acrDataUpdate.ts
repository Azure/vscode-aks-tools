import { ClusterKey } from "../../../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { newLoaded, newLoading } from "../../../utilities/lazy";
import { AcrReferenceData, createClusterId } from "../stateTypes";

export function setRoleAssignmentLoading(data: AcrReferenceData, clusterKey: ClusterKey): AcrReferenceData {
    return {
        ...data,
        assignedRoleDefinitions: {
            ...data.assignedRoleDefinitions,
            [createClusterId(clusterKey)]: newLoading(),
        },
    };
}

export function updateRoleAssignments(
    data: AcrReferenceData,
    clusterKey: ClusterKey,
    hasAcrPull: boolean,
): AcrReferenceData {
    return {
        ...data,
        assignedRoleDefinitions: {
            ...data.assignedRoleDefinitions,
            [createClusterId(clusterKey)]: newLoaded({ hasAcrPull }),
        },
    };
}
