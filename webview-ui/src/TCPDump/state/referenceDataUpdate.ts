import { FilterPod, NodeName } from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { replaceItem, updateValues } from "../../utilities/array";
import { map as lazyMap, newLoaded, newLoading, newNotLoaded, orDefault } from "../../utilities/lazy";
import { ReferenceData, NodeReferenceData } from "../state";
import * as NodeReferenceDataUpdate from "./nodeReferenceDataUpdate";

export function setNodesLoading(data: ReferenceData): ReferenceData {
    return { ...data, nodes: newLoading() };
}

export function updateNodes(data: ReferenceData, nodes: NodeName[]): ReferenceData {
    const existingNodes = orDefault(data.nodes, []);
    const updatedNodes = updateValues(
        existingNodes,
        nodes,
        (data) => data.node,
        (node) => ({
            node,
            filterPods: newNotLoaded(),
        }),
    );

    return {
        ...data,
        nodes: newLoaded(updatedNodes),
    };
}

export function setFilterPodsLoading(data: ReferenceData, node: NodeName): ReferenceData {
    return updateNode(data, node, (data) => NodeReferenceDataUpdate.setFilterPodsLoading(data));
}

export function updateFilterPods(data: ReferenceData, node: NodeName, pods: FilterPod[]): ReferenceData {
    return updateNode(data, node, (data) => NodeReferenceDataUpdate.updateFilterPods(data, pods));
}

function updateNode(
    data: ReferenceData,
    node: NodeName,
    updater: (data: NodeReferenceData) => NodeReferenceData,
): ReferenceData {
    return {
        ...data,
        nodes: lazyMap(data.nodes, (nodes) => replaceItem(nodes, (data) => data.node === node, updater)),
    };
}
