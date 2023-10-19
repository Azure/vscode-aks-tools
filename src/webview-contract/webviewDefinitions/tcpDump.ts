import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string,
    allNodes: string[]
}

export type ToVsCodeMsgDef = {
    startDebugPod: {
        node: string
    },
    startTcpDump: {
        node: string
    },
    endTcpDump: {
        node: string
    },
    downloadCaptureFile: {
        node: string,
        localcapfile: string
    }
};

export type CommandResult = {
    succeeded: boolean,
    errorMessage: string | null
};

export type ToWebViewMsgDef = {
    startDebugPodResponse: CommandResult,
    startTcpDumpResponse: CommandResult,
    endTcpDumpResponse: CommandResult,
    downloadCaptureFileResponse: CommandResult
};

export type TCPDumpDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
