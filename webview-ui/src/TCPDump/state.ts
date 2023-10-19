import { InitialState, CommandResult } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { StateMessageHandler, WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export enum NodeTcpDumpStatus {
    NotStarted,
    CreatingDebugPod,
    DebugPodRunning,
    Starting,
    Running,
    Stopping,
    Completed,
    Downloading,
    Downloaded
}

type NodeTcpDumpState = {
    nodeDumpStatus: NodeTcpDumpStatus,
    errorMessage: string | null
};

export type TcpDumpState = InitialState & NodeTcpDumpState & {
    selectedNode: string | null
};

export type EventDef = {
    setSelectedNode: string | null,
    creatingNodeDebugPod: void,
    startingNodeCapture: void,
    stoppingNodeCapture: void,
    downloadingNodeCapture: void
};

export const stateUpdater: WebviewStateUpdater<"tcpDump", EventDef, TcpDumpState> = {
    createState: initialState => ({
        ...initialState,
        selectedNode: null,
        nodeDumpStatus: NodeTcpDumpStatus.NotStarted,
        errorMessage: null
    }),
    vscodeMessageHandler: {
        startDebugPodResponse: (state, args) => ({...state, ...getNodeDumpState(args, NodeTcpDumpStatus.DebugPodRunning, NodeTcpDumpStatus.NotStarted)}),
        startTcpDumpResponse: (state, args) => ({...state, ...getNodeDumpState(args, NodeTcpDumpStatus.Running, NodeTcpDumpStatus.DebugPodRunning)}),
        endTcpDumpResponse: (state, args) => ({...state, ...getNodeDumpState(args, NodeTcpDumpStatus.Completed, NodeTcpDumpStatus.Running)}),
        downloadCaptureFileResponse: (state, args) => ({...state, ...getNodeDumpState(args, NodeTcpDumpStatus.Downloaded, NodeTcpDumpStatus.Completed)})
    },
    eventHandler: {
        setSelectedNode: (state, node) => ({...state, selectedNode: node}),
        creatingNodeDebugPod: state => ({...state, nodeDumpStatus: NodeTcpDumpStatus.CreatingDebugPod}),
        startingNodeCapture: state => ({...state, nodeDumpStatus: NodeTcpDumpStatus.Starting}),
        stoppingNodeCapture: state => ({...state, nodeDumpStatus: NodeTcpDumpStatus.Stopping}),
        downloadingNodeCapture: state => ({...state, nodeDumpStatus: NodeTcpDumpStatus.Downloading})
    }
};

function getNodeDumpState(result: CommandResult, statusIfSucceeded: NodeTcpDumpStatus, statusIfFailed: NodeTcpDumpStatus): NodeTcpDumpState {
    return {
        nodeDumpStatus: result.succeeded ? statusIfSucceeded : statusIfFailed,
        errorMessage: result.succeeded ? null : result.errorMessage
    };
}

export const vscode = getWebviewMessageContext<"tcpDump">({
    startDebugPod: null,
    startTcpDump: null,
    endTcpDump: null,
    downloadCaptureFile: null
});