import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    selectedNode: string;
    clusterName: string;
    retinaOutput: string[];
    allNodes: string[];
    captureFolderName: string;
}

export type ToVsCodeMsgDef = {
    retinaCaptureResult: string;
    getAllNodes: void;
    runRetinaCapture: string;
};

export type ToWebViewMsgDef = { (): void };

export type RetinaCaptureDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef & { [key: string]: unknown }>;
