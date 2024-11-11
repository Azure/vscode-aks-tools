import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
    modelName: string;
    output: string;
}

export type ToVsCodeMsgDef = {
    queryRequest: {
        prompt: string;
        temperature: number;
        topP: number;
        topK: number;
        repetitionPenalty: number;
        maxLength: number;
    };
};

export type ToWebViewMsgDef = {
    testUpdate: {
        clusterName: string;
        modelName: string;
        output: string;
    };
};

export type KaitoTestDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
