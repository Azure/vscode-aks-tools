import { FilterPod } from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { newLoaded, newLoading } from "../../utilities/lazy";
import { NodeReferenceData } from "../state";

export function setFilterPodsLoading(data: NodeReferenceData): NodeReferenceData {
    return { ...data, filterPods: newLoading() };
}

export function updateFilterPods(data: NodeReferenceData, pods: FilterPod[]): NodeReferenceData {
    return {
        ...data,
        filterPods: newLoaded(pods),
    };
}
