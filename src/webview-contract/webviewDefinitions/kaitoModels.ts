import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string;
    subscriptionId: string;
    resourceGroupName: string;
}

export interface Workspace {
    name: string;
    instanceType: string;
}

export interface WorkspaceCRD {
    workspace: string; // workspace CRD yaml
}

export type ToVsCodeMsgDef = {
    generateCRDRequest: { model: string };
};

export enum ProgressEventType {
    NotStarted,
    InProgress,
    Cancelled,
    Failed,
    Success,
}

export type ToWebViewMsgDef = {
    generateCRDResponse: { crdText: string };
};

export type ModelDetails = {
    family: string;
    modelName: string;
    minimumGpu: number;
    kaitoVersion: string;
    modelSource: string;
};

export type KaitoModelsDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
