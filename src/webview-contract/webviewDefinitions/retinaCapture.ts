import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
    retinaOutput: string[];
    allNodes: string[];
}

export type CommandResult = {
    succeeded: boolean;
    errorMessage: string | null;
};

export type RetinaCaptureResult = string;
export type CaptureName = string;
export type NodeName = string;
export type NodeCaptureCommandResult = string;

export type ValueCommandResult<TCommandResult extends CommandResult, TValue> = TCommandResult & {
    value: TValue;
};

export type ToVsCodeMsgDef = {
    retinaCaptureResult: RetinaCaptureResult;
    getAllNodes: void;
    openFolder: string;
};

export type ToWebViewMsgDef = {
    startCaptureResponse: NodeCaptureCommandResult;
    getAllNodesResponse: ValueCommandResult<CommandResult, NodeName[]>;
};

export type RetinaCaptureDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
