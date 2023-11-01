import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string,
    allNodes: string[]
}

export type NodeName = string;
export type CaptureName = string;

export type CompletedCapture = {
    name: CaptureName,
    sizeInKB: number
};

export type NodeCommand = {
    node: NodeName
};

export type NodeCaptureCommand = NodeCommand & {
    capture: CaptureName
};

export type CommandResult = {
    succeeded: boolean,
    errorMessage: string | null
};

export type NodeCommandResult = CommandResult & {
    node: NodeName
};

export type NodeCaptureStopResult = NodeCommandResult & {
    capture: CompletedCapture | null
};

export type NodeCaptureCommandResult = NodeCommandResult & {
    captureName: CaptureName
};

export type NodeCheckResult = NodeCommandResult & {
    isDebugPodRunning: boolean,
    runningCapture: CaptureName | null,
    completedCaptures: CompletedCapture[]
};

export type NodeCaptureDownloadResult = NodeCaptureCommandResult & {
    localCapturePath: string
};

export type ToVsCodeMsgDef = {
    checkNodeState: NodeCommand,
    startDebugPod: NodeCommand,
    startCapture: NodeCaptureCommand,
    stopCapture: NodeCaptureCommand,
    downloadCaptureFile: NodeCaptureCommand,
    deleteDebugPod: NodeCommand,
    openFolder: string
};

export type ToWebViewMsgDef = {
    checkNodeStateResponse: NodeCheckResult,
    startDebugPodResponse: NodeCommandResult,
    startCaptureResponse: NodeCommandResult,
    stopCaptureResponse: NodeCaptureStopResult,
    downloadCaptureFileResponse: NodeCaptureDownloadResult,
    deleteDebugPodResponse: NodeCommandResult
};

export type TCPDumpDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
