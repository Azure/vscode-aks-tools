import { newLoaded, newLoading } from "../../../utilities/lazy";
import { ClusterReferenceData } from "../stateTypes";

export function setNamespacesLoading(data: ClusterReferenceData): ClusterReferenceData {
    return {
        ...data,
        namespaces: newLoading(),
    };
}

export function updateNamespaces(data: ClusterReferenceData, namespaces: string[]): ClusterReferenceData {
    return {
        ...data,
        namespaces: newLoaded(namespaces),
    };
}
