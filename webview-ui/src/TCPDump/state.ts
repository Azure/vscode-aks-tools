import {
    InitialState,
    NodeName,
    CaptureName,
    InterfaceName,
    FilterPod,
} from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { Lazy, newLoading, newNotLoaded } from "../utilities/lazy";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";
import { ApplicationLayerProtocol, TransportLayerProtocol } from "./protocols";
import * as CaptureNodeUpdate from "./state/captureNodeUpdate";
import * as ReferenceDataUpdate from "./state/referenceDataUpdate";

export enum NodeStatus {
    Unknown,
    Checking,
    Clean,
    CreatingDebugPod,
    DeletingDebugPod,
    DebugPodRunning,
    CaptureStarting,
    CaptureRunning,
    CaptureStopping,
}

export enum CaptureStatus {
    Completed,
    Downloading,
    Downloaded,
}

export type CaptureScenario = "SpecificPod" | "TwoPods";

export type CaptureScenarioFilters = {
    SpecificPod: SpecificPodFilter;
    TwoPods: TwoPodsFilter;
};

export type ScenarioFilterValue = {
    [P in CaptureScenario]: {
        node: NodeName;
        scenario: P;
        filters: CaptureScenarioFilters[P];
    };
}[CaptureScenario];

export type SpecificPodFilter = {
    pod: FilterPod | null;
    packetDirection: SingleEndpointPacketDirection;
};

export type TwoPodsFilter = {
    sourceNode: NodeName | null;
    sourcePod: FilterPod | null;
    destNode: NodeName | null;
    destPod: FilterPod | null;
    packetDirection: DualEndpointPacketDirection;
};

export type SingleEndpointPacketDirection = "SentAndReceived" | "Sent" | "Received";

export type DualEndpointPacketDirection = "SourceToDestination" | "Bidirectional";

export type CaptureFilterSelection = {
    interface: InterfaceName | null;
    scenario: CaptureScenario | null;
    scenarioFilters: CaptureScenarioFilters;
    appLayerProtocol: ApplicationLayerProtocol | null;
    port: number | null;
    transportLayerProtocol: TransportLayerProtocol | null;
    pcapFilterString: string | null;
};

export type NodeState = {
    status: NodeStatus;
    errorMessage: string | null;
    currentCaptureName: CaptureName | null;
    currentCaptureFilters: CaptureFilterSelection;
    completedCaptures: NodeCapture[];
    captureInterfaces: Lazy<InterfaceName[]>;
};

type NodeStates = { [name: NodeName]: NodeState };

export type NodeCapture = {
    name: CaptureName;
    status: CaptureStatus;
    sizeInKB: number;
    downloadedFilePath: string | null;
};

export type TcpDumpState = InitialState & {
    selectedNode: NodeName | null;
    nodeStates: NodeStates;
    referenceData: ReferenceData;
};

export type ReferenceData = {
    nodes: Lazy<NodeReferenceData[]>;
};

export type NodeReferenceData = {
    node: NodeName;
    filterPods: Lazy<FilterPod[]>;
};

export type EventDef = {
    setSelectedNode: string | null;
    setCheckingNodeState: { node: NodeName };
    creatingNodeDebugPod: { node: NodeName };
    deletingNodeDebugPod: { node: NodeName };
    startingNodeCapture: { node: NodeName; capture: CaptureName };
    stoppingNodeCapture: { node: NodeName };
    downloadingNodeCapture: { node: NodeName; capture: CaptureName };
    setCaptureFilters: { node: NodeName; filters: CaptureFilterSelection };
    setCaptureScenarioFilters: ScenarioFilterValue;
    refreshPcapFilterString: { node: NodeName };
    setLoadingNodes: void;
    setLoadingInterfaces: { node: NodeName };
    setLoadingFilterPods: { node: NodeName };
};

export const stateUpdater: WebviewStateUpdater<"tcpDump", EventDef, TcpDumpState> = {
    createState: (initialState) => ({
        ...initialState,
        selectedNode: null,
        nodeStates: {},
        referenceData: {
            nodes: newNotLoaded(),
        },
    }),
    vscodeMessageHandler: {
        checkNodeStateResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => CaptureNodeUpdate.updateFromNodeCheck(nodeState, args)),
        startDebugPodResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromStartPodResult(nodeState, args),
            ),
        deleteDebugPodResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromDeletePodResult(nodeState, args),
            ),
        startCaptureResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromCaptureStartResult(nodeState, args),
            ),
        stopCaptureResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromCaptureStopResult(nodeState, args),
            ),
        downloadCaptureFileResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromDownloadResult(nodeState, args),
            ),
        getInterfacesResponse: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateCaptureInterfaces(nodeState, args),
            ),
        getAllNodesResponse: (state, args) => ({
            ...state,
            referenceData: ReferenceDataUpdate.updateNodes(state.referenceData, args.value),
        }),
        getFilterPodsForNodeResponse: (state, args) => ({
            ...state,
            referenceData: ReferenceDataUpdate.updateFilterPods(state.referenceData, args.node, args.value),
        }),
    },
    eventHandler: {
        setSelectedNode: (state, node) => ({ ...ensureNodeStateExists(state, node), selectedNode: node }),
        setCheckingNodeState: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, status: NodeStatus.Checking })),
        creatingNodeDebugPod: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, status: NodeStatus.CreatingDebugPod })),
        deletingNodeDebugPod: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, status: NodeStatus.DeletingDebugPod })),
        startingNodeCapture: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromCaptureStarting(nodeState, args.capture),
            ),
        stoppingNodeCapture: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, status: NodeStatus.CaptureStopping })),
        downloadingNodeCapture: (state, args) =>
            updateNodeState(state, args.node, (nodeState) =>
                CaptureNodeUpdate.updateFromDownloadStarting(nodeState, args.capture),
            ),
        setCaptureFilters: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, currentCaptureFilters: args.filters })),
        setCaptureScenarioFilters: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => CaptureNodeUpdate.updateScenarioFilter(nodeState, args)),
        refreshPcapFilterString: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => CaptureNodeUpdate.refreshPcapFilterString(nodeState)),
        setLoadingInterfaces: (state, args) =>
            updateNodeState(state, args.node, (nodeState) => ({ ...nodeState, captureInterfaces: newLoading() })),
        setLoadingNodes: (state) => updateReferenceData(state, ReferenceDataUpdate.setNodesLoading),
        setLoadingFilterPods: (state, args) =>
            updateReferenceData(state, (data) => ReferenceDataUpdate.setFilterPodsLoading(data, args.node)),
    },
};

function ensureNodeStateExists(state: TcpDumpState, node: NodeName | null): TcpDumpState {
    if (!node) return state;
    const nodeStates = { [node]: CaptureNodeUpdate.getInitialNodeState(node), ...state.nodeStates };
    return { ...state, nodeStates };
}

function updateNodeState(
    state: TcpDumpState,
    node: NodeName,
    updater: (nodeState: NodeState) => NodeState,
): TcpDumpState {
    const nodeState = state.nodeStates[node];
    const nodeStates = { ...state.nodeStates, [node]: updater(nodeState) };
    return { ...state, nodeStates };
}

function updateReferenceData(state: TcpDumpState, updater: (data: ReferenceData) => ReferenceData): TcpDumpState {
    return {
        ...state,
        referenceData: updater(state.referenceData),
    };
}

export const vscode = getWebviewMessageContext<"tcpDump">({
    checkNodeState: null,
    startDebugPod: null,
    startCapture: null,
    stopCapture: null,
    downloadCaptureFile: null,
    openFolder: null,
    deleteDebugPod: null,
    getInterfaces: null,
    getAllNodes: null,
    getFilterPodsForNode: null,
});
