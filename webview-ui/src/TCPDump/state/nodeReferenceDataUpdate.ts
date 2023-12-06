import { newLoaded, newLoading } from "../../utilities/lazy";
import { FilterPod, NodeReferenceData } from "../state";

export function setFilterPodsLoading(data: NodeReferenceData): NodeReferenceData {
    return { ...data, filterPods: newLoading() };
}

export function updateFilterPods(data: NodeReferenceData, pods: FilterPod[]): NodeReferenceData {
    return {
        ...data,
        filterPods: newLoaded(pods),
    };
}
