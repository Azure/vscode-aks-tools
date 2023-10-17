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

export type ToWebViewMsgDef = {
    // TODO : Delete
    runCommandResponse: {
        output: string | null
        errorMessage: string | null
    }
};

export type TCPDumpDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
