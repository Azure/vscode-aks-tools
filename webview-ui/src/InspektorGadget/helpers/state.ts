import {
    ClusterResources,
    Nodes,
    setContainersLoading,
    setPodsLoading,
    updateContainersForCluster,
    updateNamespacesForCluster,
    updateNodesForCluster,
    updatePodsForCluster,
} from "./clusterResources";
import { newLoading, newNotLoaded } from "../../utilities/lazy";
import { TraceGadget, enrich, enrichSortAndFilter } from "./gadgets";
import { GadgetVersion, TraceOutputItem } from "../../../../src/webview-contract/webviewDefinitions/inspektorGadget";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

// TODO: Make configurable?
const maxTraceOutputLength = 1000;

export interface InspektorGadgetState {
    initializationStarted: boolean;
    nextTraceId: number;
    version: GadgetVersion | null;
    nodes: Nodes;
    resources: ClusterResources;
    overviewStatus: string;
    allTraces: TraceGadget[];
}

export type EventDef = {
    setInitializing: void;
    deploy: void;
    undeploy: void;
    incrementTraceId: void;
    createTrace: {
        trace: TraceGadget;
    };
    deleteTraces: {
        traceIds: number[];
    };
    setNodesLoading: void;
    setNamespacesLoading: void;
    setPodsLoading: {
        namespace: string;
    };
    setContainersLoading: {
        namespace: string;
        podName: string;
    };
    setNodesNotLoaded: void;
    setNamespacesNotLoaded: void;
};

export const stateUpdater: WebviewStateUpdater<"gadget", EventDef, InspektorGadgetState> = {
    createState: () => ({
        initializationStarted: false,
        nextTraceId: 0,
        version: null,
        nodes: newNotLoaded(),
        resources: newNotLoaded(),
        overviewStatus: "Initializing",
        allTraces: [],
    }),
    vscodeMessageHandler: {
        updateVersion: (state, args) => ({ ...state, overviewStatus: "", version: args }),
        runTraceResponse: (state, args) => ({
            ...state,
            allTraces: getUpdatedTraces(state.allTraces, args.traceId, args.items),
        }),
        getNodesResponse: (state, args) => ({ ...state, nodes: updateNodesForCluster(args.nodes) }),
        getNamespacesResponse: (state, args) => ({ ...state, resources: updateNamespacesForCluster(args.namespaces) }),
        getPodsResponse: (state, args) => ({
            ...state,
            resources: updatePodsForCluster(state.resources, args.namespace, args.podNames),
        }),
        getContainersResponse: (state, args) => ({
            ...state,
            resources: updateContainersForCluster(state.resources, args.namespace, args.podName, args.containerNames),
        }),
    },
    eventHandler: {
        setInitializing: (state) => ({ ...state, initializationStarted: true }),
        deploy: (state) => ({ ...state, overviewStatus: "Deploying Inspektor Gadget", version: null }),
        undeploy: (state) => ({ ...state, overviewStatus: "Undeploying Inspektor Gadget", version: null }),
        incrementTraceId: (state) => ({ ...state, nextTraceId: state.nextTraceId + 1 }),
        createTrace: (state, args) => ({ ...state, allTraces: [...state.allTraces, args.trace] }),
        deleteTraces: (state, args) => ({
            ...state,
            allTraces: state.allTraces.filter((t) => !args.traceIds.includes(t.traceId)),
        }),
        setNodesLoading: (state) => ({ ...state, nodes: newLoading() }),
        setNamespacesLoading: (state) => ({ ...state, resources: newLoading() }),
        setPodsLoading: (state, args) => ({ ...state, resources: setPodsLoading(state.resources, args.namespace) }),
        setContainersLoading: (state, args) => ({
            ...state,
            resources: setContainersLoading(state.resources, args.namespace, args.podName),
        }),
        setNodesNotLoaded: (state) => ({ ...state, nodes: newNotLoaded() }),
        setNamespacesNotLoaded: (state) => ({ ...state, resources: newNotLoaded() }),
    },
};

function getUpdatedTraces(traces: TraceGadget[], traceId: number, items: TraceOutputItem[]): TraceGadget[] {
    const traceIndex = traces.findIndex((t) => t.traceId === traceId);
    if (traceIndex === -1) {
        return traces;
    }

    const trace = traces[traceIndex];
    const appendItems = trace.category === "trace";
    const newItems = appendItems
        ? [...(trace.output || []), ...enrich(trace, items)].slice(-maxTraceOutputLength) // Append to the existing items.
        : enrichSortAndFilter(trace, items); // Replace the existing items in the trace.

    const newTrace = { ...trace, output: newItems };
    return [...traces.slice(0, traceIndex), newTrace, ...traces.slice(traceIndex + 1)];
}

export const vscode = getWebviewMessageContext<"gadget">({
    deployRequest: null,
    getContainersRequest: null,
    getNamespacesRequest: null,
    getNodesRequest: null,
    getPodsRequest: null,
    getVersionRequest: null,
    runBlockingTraceRequest: null,
    runStreamingTraceRequest: null,
    stopStreamingTraceRequest: null,
    undeployRequest: null,
});
