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
    namespace: string;
};

export type ToVsCodeMsgDef = {
    monitorUpdateRequest: {};
    deleteWorkspaceRequest: { model: string; namespace: string };
    redeployWorkspaceRequest: { modelName: string; modelYaml: string | undefined; namespace: string };
    getLogsRequest: {};
    testWorkspaceRequest: { modelName: string; namespace: string };
};

export type ToWebViewMsgDef = {
    monitorUpdate: {
        clusterName: string;
        models: ModelState[];
    };
};

export type KaitoManageDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
