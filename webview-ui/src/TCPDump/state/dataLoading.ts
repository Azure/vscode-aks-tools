import { NodeName } from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { isNotLoaded } from "../../utilities/lazy";
import { EventHandlers } from "../../utilities/state";
import { EventDef, NodeReferenceData, NodeState, ReferenceData, vscode } from "../state";

export type EventHandlerFunc = (eventHandlers: EventHandlers<EventDef>) => void;

export function loadAllNodes(referenceData: ReferenceData, updates: EventHandlerFunc[]): void {
    if (isNotLoaded(referenceData.nodes)) {
        vscode.postGetAllNodes();
        updates.push((e) => e.onSetLoadingNodes());
    }
}

export function loadFilterPods(nodeReferenceData: NodeReferenceData, updates: EventHandlerFunc[]): void {
    if (isNotLoaded(nodeReferenceData.filterPods)) {
        vscode.postGetFilterPodsForNode({ node: nodeReferenceData.node });
        updates.push((e) => e.onSetLoadingFilterPods({ node: nodeReferenceData.node }));
    }
}

export function loadCaptureInterfaces(nodeState: NodeState, node: NodeName, updates: EventHandlerFunc[]): void {
    if (isNotLoaded(nodeState.captureInterfaces)) {
        vscode.postGetInterfaces({ node });
        updates.push((e) => e.onSetLoadingInterfaces({ node }));
    }
}
