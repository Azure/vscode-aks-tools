import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    selectedNode: string;
    clusterName: string;
    retinaOutput: string[];
    allNodes: string[];
    captureFolderName: string;
    isNodeExplorerPodExists: boolean;
}

export type ToVsCodeMsgDef = {
    deleteRetinaNodeExplorer: string;
    handleCaptureFileDownload: string;
};

export type ToWebViewMsgDef = Record<string, never>;

export type RetinaCaptureDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
