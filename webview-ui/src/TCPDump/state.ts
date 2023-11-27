import {
    InitialState,
    NodeName,
    NodeCommandResult,
    CaptureName,
    NodeCheckResult,
    NodeCaptureDownloadResult,
    NodeCaptureStopResult,
} from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { replaceItem } from "../utilities/array";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

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

type NodeState = {
    status: NodeStatus;
    errorMessage: string | null;
    currentCaptureName: CaptureName | null;
    completedCaptures: NodeCapture[];
};

type NodeStates = { [name: NodeName]: NodeState };

type NodeCapture = {
    name: CaptureName;
    status: CaptureStatus;
    sizeInKB: number;
    downloadedFilePath: string | null;
};

export type TcpDumpState = InitialState & {
    selectedNode: NodeName | null;
    nodeStates: NodeStates;
};

export type EventDef = {
    setSelectedNode: string | null;
    setCheckingNodeState: { node: NodeName };
    creatingNodeDebugPod: { node: NodeName };
    deletingNodeDebugPod: { node: NodeName };
    startingNodeCapture: { node: NodeName; capture: CaptureName };
    stoppingNodeCapture: { node: NodeName };
    downloadingNodeCapture: { node: NodeName; capture: CaptureName };
};

export const stateUpdater: WebviewStateUpdater<"tcpDump", EventDef, TcpDumpState> = {
    createState: (initialState) => ({
        ...initialState,
        selectedNode: null,
        nodeStates: {},
    }),
    vscodeMessageHandler: {
        checkNodeStateResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromCheck(state.nodeStates, args),
        }),
        startDebugPodResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromPodCreation(state.nodeStates, args),
        }),
        deleteDebugPodResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromPodDeletion(state.nodeStates, args),
        }),
        startCaptureResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromCaptureStartResult(state.nodeStates, args),
        }),
        stopCaptureResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromCaptureStopResult(state.nodeStates, args),
        }),
        downloadCaptureFileResponse: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromDownloadResult(state.nodeStates, args),
        }),
    },
    eventHandler: {
        setSelectedNode: (state, node) => ({
            ...state,
            selectedNode: node,
            nodeStates: ensureNodeStateExists(state.nodeStates, node),
        }),
        setCheckingNodeState: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromStatus(state.nodeStates, args.node, NodeStatus.Checking),
        }),
        creatingNodeDebugPod: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromStatus(state.nodeStates, args.node, NodeStatus.CreatingDebugPod),
        }),
        deletingNodeDebugPod: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromStatus(state.nodeStates, args.node, NodeStatus.DeletingDebugPod),
        }),
        startingNodeCapture: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromCaptureStarting(state.nodeStates, args.node, args.capture),
        }),
        stoppingNodeCapture: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromStatus(state.nodeStates, args.node, NodeStatus.CaptureStopping),
        }),
        downloadingNodeCapture: (state, args) => ({
            ...state,
            nodeStates: getNodeStatesFromDownloadStarting(state.nodeStates, args.node, args.capture),
        }),
    },
};

function ensureNodeStateExists(nodeStates: NodeStates, node: NodeName | null): NodeStates {
    if (!node) return nodeStates;
    const defaultNodeState: NodeState = {
        status: NodeStatus.Unknown,
        errorMessage: null,
        currentCaptureName: null,
        completedCaptures: [],
    };
    return { [node]: defaultNodeState, ...nodeStates };
}

function getNodeStatesFromCheck(nodeStates: NodeStates, result: NodeCheckResult): NodeStates {
    const status = !result.isDebugPodRunning
        ? NodeStatus.Clean
        : result.runningCapture === null
          ? NodeStatus.DebugPodRunning
          : NodeStatus.CaptureRunning;

    const currentCaptureName = result.runningCapture;

    const completedCaptures = result.completedCaptures.map<NodeCapture>((c) => ({
        name: c.name,
        sizeInKB: c.sizeInKB,
        status: CaptureStatus.Completed,
        downloadedFilePath: null,
    }));

    const nodeState: NodeState = { ...nodeStates[result.node], status, currentCaptureName, completedCaptures };
    return { ...nodeStates, [result.node]: nodeState };
}

function getNodeStatesFromStatus(nodeStates: NodeStates, node: NodeName, newStatus: NodeStatus): NodeStates {
    return updateNodeState(nodeStates, node, (state) => ({ ...state, status: newStatus }));
}

function getNodeStatesFromPodCreation(nodeStates: NodeStates, result: NodeCommandResult): NodeStates {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.DebugPodRunning : NodeStatus.Unknown;
    return updateNodeState(nodeStates, result.node, (state) => ({ ...state, status, errorMessage }));
}

function getNodeStatesFromPodDeletion(nodeStates: NodeStates, result: NodeCommandResult): NodeStates {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.Clean : NodeStatus.Unknown;
    const currentCaptureName = null;
    const completedCaptures: NodeCapture[] = [];
    return updateNodeState(nodeStates, result.node, (state) => ({
        ...state,
        status,
        errorMessage,
        currentCaptureName,
        completedCaptures,
    }));
}

function getNodeStatesFromCaptureStarting(nodeStates: NodeStates, node: NodeName, capture: CaptureName): NodeStates {
    return updateNodeState(nodeStates, node, (state) => ({
        ...state,
        status: NodeStatus.CaptureStarting,
        currentCaptureName: capture,
    }));
}

function getNodeStatesFromCaptureStartResult(nodeStates: NodeStates, result: NodeCommandResult): NodeStates {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.CaptureRunning : NodeStatus.DebugPodRunning;
    return updateNodeState(nodeStates, result.node, (state) => {
        const currentCaptureName = result.succeeded ? state.currentCaptureName : null;
        return { ...state, status, errorMessage, currentCaptureName };
    });
}

function getNodeStatesFromCaptureStopResult(nodeStates: NodeStates, result: NodeCaptureStopResult): NodeStates {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.DebugPodRunning : NodeStatus.Unknown;
    return updateNodeState(nodeStates, result.node, (state) => {
        const newCapture: NodeCapture | null =
            result.succeeded && result.capture
                ? {
                      name: result.capture.name,
                      sizeInKB: result.capture.sizeInKB,
                      status: CaptureStatus.Completed,
                      downloadedFilePath: null,
                  }
                : null;
        const completedCaptures: NodeCapture[] = newCapture
            ? [...state.completedCaptures, newCapture]
            : state.completedCaptures;
        return { ...state, status, errorMessage, completedCaptures };
    });
}

function getNodeStatesFromDownloadStarting(
    nodeStates: NodeStates,
    node: NodeName,
    captureName: CaptureName,
): NodeStates {
    return updateCapture(nodeStates, node, captureName, (c) => ({ ...c, status: CaptureStatus.Downloading }));
}

function getNodeStatesFromDownloadResult(nodeStates: NodeStates, result: NodeCaptureDownloadResult): NodeStates {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    nodeStates = updateNodeState(nodeStates, result.node, (state) => ({ ...state, errorMessage }));

    const status = result.succeeded ? CaptureStatus.Downloaded : CaptureStatus.Completed;
    const downloadedFilePath = result.succeeded ? result.localCapturePath : null;
    nodeStates = updateCapture(nodeStates, result.node, result.captureName, (c) => ({
        ...c,
        status,
        downloadedFilePath,
    }));

    return nodeStates;
}

function updateNodeState(nodeStates: NodeStates, node: NodeName, updater: (nodeState: NodeState) => NodeState) {
    return { ...nodeStates, [node]: updater(nodeStates[node]) };
}

function updateCapture(
    nodeStates: NodeStates,
    node: NodeName,
    captureName: CaptureName,
    updater: (capture: NodeCapture) => NodeCapture,
): NodeStates {
    const completedCaptures = replaceItem(nodeStates[node].completedCaptures, (c) => c.name === captureName, updater);
    return updateNodeState(nodeStates, node, (state) => ({ ...state, completedCaptures }));
}

export const vscode = getWebviewMessageContext<"tcpDump">({
    checkNodeState: null,
    startDebugPod: null,
    startCapture: null,
    stopCapture: null,
    downloadCaptureFile: null,
    openFolder: null,
    deleteDebugPod: null,
});
