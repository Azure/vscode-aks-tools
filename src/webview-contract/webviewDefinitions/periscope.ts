import { WebviewDefinition } from "../webviewTypes";

export interface NodeUploadStatus {
    nodeName: string;
    isUploaded: boolean;
}

export interface PodLogs {
    podName: string;
    logs: string;
}

export type DeploymentState = "error" | "noDiagnosticsConfigured" | "success";

export interface KustomizeConfig {
    repoOrg: string;
    containerRegistry: string;
    imageVersion: string;
    releaseTag: string;
}

export interface InitialState {
    clusterName: string;
    runId: string;
    state: DeploymentState;
    message: string;
    nodes: string[];
    kustomizeConfig: KustomizeConfig | null;
    blobContainerUrl: string;
    shareableSas: string;
}

export type ToVsCodeMsgDef = {
    uploadStatusRequest: void;
    nodeLogsRequest: {
        nodeName: string;
    };
};

export type ToWebViewMsgDef = {
    uploadStatusResponse: {
        uploadStatuses: NodeUploadStatus[];
    };
    nodeLogsResponse: {
        nodeName: string;
        logs: PodLogs[];
    };
};

export type PeriscopeDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
