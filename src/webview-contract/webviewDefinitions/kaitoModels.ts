import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
    modelName: string;
    workspaceExists: boolean;
    resourceReady: boolean | null;
    inferenceReady: boolean | null;
    workspaceReady: boolean | null;
    age: number;
}

export type ToVsCodeMsgDef = {
    generateCRDRequest: { model: string | undefined };
    deployKaitoRequest: { model: string; yaml: string | undefined; gpu: string };
    resetStateRequest: Record<string, never>;
    cancelRequest: { model: string };
    kaitoManageRedirectRequest: Record<string, never>;
};

export type ToWebViewMsgDef = {
    deploymentProgressUpdate: {
        clusterName: string;
        modelName: string;
        workspaceExists: boolean;
        resourceReady: boolean | null;
        inferenceReady: boolean | null;
        workspaceReady: boolean | null;
        age: number;
    };
};

export type ModelDetails = {
    family: string;
    modelName: string;
    minimumGpu: number;
    kaitoVersion: string;
    modelSource: string;
};

export type KaitoModelsDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
