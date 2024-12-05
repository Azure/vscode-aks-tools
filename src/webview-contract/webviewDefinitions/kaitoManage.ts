import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
    models: ModelState[];
}

export type ModelState = {
    name: string;
    instance: string;
    resourceReady: boolean | null;
    inferenceReady: boolean | null;
    workspaceReady: boolean | null;
    age: number;
};

export type ToVsCodeMsgDef = {
    monitorUpdateRequest: {};
    deleteWorkspaceRequest: { model: string };
    redeployWorkspaceRequest: { modelName: string; modelYaml: string };
    getLogsRequest: {};
    testWorkspaceRequest: { modelName: string };
};

export type ToWebViewMsgDef = {
    monitorUpdate: {
        clusterName: string;
        models: ModelState[];
    };
};

export type KaitoManageDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
