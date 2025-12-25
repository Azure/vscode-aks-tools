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
    installKaitoRequest: void; // from webview when install kaito button is clicked
    generateWorkspaceRequest: void; // from webview when generate workspace button is clicked
};

export enum ProgressEventType {
    NotStarted,
    InProgress,
    Cancelled,
    Failed,
    Success,
}

export type ToWebViewMsgDef = {
    kaitoInstallProgressUpdate: {
        operationDescription: string;
        event: ProgressEventType;
        errorMessage: string | undefined;
    }; // to webview during kaito installation
    getWorkspaceResponse: {
        workspace: WorkspaceCRD;
    }; // to webview after workspace CRD is generated
};

export type ModelDetails = {
    family: string;
    modelName: string;
    minimumGpu: number;
    kaitoVersion: string;
    modelSource: string;
};

export type KaitoDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
