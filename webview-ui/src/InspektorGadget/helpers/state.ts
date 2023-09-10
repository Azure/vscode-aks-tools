import { ClusterResources, Nodes, setContainersLoading, setPodsLoading, updateContainersForCluster, updateNamespacesForCluster, updateNodesForCluster, updatePodsForCluster } from "./clusterResources";
import { UserMsgDef } from "./userCommands";
import { newLoading, newNotLoaded } from "../../utilities/lazy";
import { TraceGadget, enrich, enrichSortAndFilter } from "./gadgets";
import { GadgetVersion, ToWebViewMsgDef, TraceOutputItem } from "../../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { StateMessageHandler, chainStateUpdaters, toStateUpdater } from "../../utilities/state";

// TODO: Make configurable?
const maxTraceOutputLength = 1000;

export interface InspektorGadgetState {
    initializationStarted: boolean
    nextTraceId: number
    version: GadgetVersion | null
    nodes: Nodes
    resources: ClusterResources
    overviewStatus: string
    allTraces: TraceGadget[]
}

export function createState(): InspektorGadgetState {
    return {
        initializationStarted: false,
        nextTraceId: 0,
        version: null,
        nodes: newNotLoaded(),
        resources: newNotLoaded(),
        overviewStatus: "Initializing",
        allTraces: []
    };
}

export const vscodeMessageHandler: StateMessageHandler<ToWebViewMsgDef, InspektorGadgetState> = {
    updateVersion: (state, args) => {
        return { ...state, overviewStatus: "", version: args };
    },
    runTraceResponse: (state, args) => {
        const allTraces = getUpdatedTraces(state.allTraces, args.traceId, args.items);
        return { ...state, allTraces };
    },
    getNodesResponse: (state, args) => {
        return { ...state, nodes: updateNodesForCluster(args.nodes) };
    },
    getNamespacesResponse: (state, args) => {
        return { ...state, resources: updateNamespacesForCluster(args.namespaces) };
    },
    getPodsResponse: (state, args) => {
        return { ...state, resources: updatePodsForCluster(state.resources, args.namespace, args.podNames) };
    },
    getContainersResponse: (state, args) => {
        return { ...state, resources: updateContainersForCluster(state.resources, args.namespace, args.podName, args.containerNames) };
    }
};

export const userMessageHandler: StateMessageHandler<UserMsgDef, InspektorGadgetState> = {
    setInitializing: (state) => {
        return { ...state, initializationStarted: true };
    },
    deploy: (state) => {
        return { ...state, overviewStatus: "Deploying Inspektor Gadget", version: null };
    },
    undeploy: (state) => {
        return { ...state, overviewStatus: "Undeploying Inspektor Gadget", version: null };
    },
    incrementTraceId: (state) => {
        return { ...state, nextTraceId: state.nextTraceId + 1 };
    },
    createTrace: (state, args) => {
        const allTraces = [...state.allTraces, args.trace];
        return { ...state, allTraces };
    },
    deleteTraces: (state, args) => {
        const allTraces = state.allTraces.filter(t => !args.traceIds.includes(t.traceId));
        return { ...state, allTraces };
    },
    setNodesLoading: (state) => {
        return { ...state, nodes: newLoading() };
    },
    setNamespacesLoading: (state) => {
        return { ...state, resources: newLoading() };
    },
    setPodsLoading: (state, args) => {
        return { ...state, resources: setPodsLoading(state.resources, args.namespace) };
    },
    setContainersLoading: (state, args) => {
        return { ...state, resources: setContainersLoading(state.resources, args.namespace, args.podName) };
    },
    setNodesNotLoaded: (state) => {
        return { ...state, nodes: newNotLoaded() };
    },
    setNamespacesNotLoaded: (state) => {
        return { ...state, resources: newNotLoaded() };
    }
};

export const updateState = chainStateUpdaters(
    toStateUpdater(vscodeMessageHandler),
    toStateUpdater(userMessageHandler));

function getUpdatedTraces(traces: TraceGadget[], traceId: number, items: TraceOutputItem[]): TraceGadget[] {
    const traceIndex = traces.findIndex(t => t.traceId === traceId);
    if (traceIndex === -1) {
        return traces;
    }

    const trace = traces[traceIndex];
    const appendItems = trace.category === "trace";
    const newItems =
        appendItems ? [...(trace.output || []), ...enrich(trace, items)].slice(-maxTraceOutputLength) // Append to the existing items.
        : enrichSortAndFilter(trace, items); // Replace the existing items in the trace.

    const newTrace = { ...trace, output: newItems };
    return [...traces.slice(0, traceIndex), newTrace, ...traces.slice(traceIndex + 1)];
}
