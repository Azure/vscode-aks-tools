import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {}

export interface GadgetVersion {
    client: string;
    server: string | null;
}

export enum NamespaceSelection {
    Default,
    All,
}

export type NamespaceFilter = NamespaceSelection | string;

export interface Filters {
    namespace: NamespaceFilter;
    nodeName?: string;
    podName?: string;
    containerName?: string;
    labels?: { [key: string]: string };
}

export interface GadgetArguments {
    gadgetCategory: string;
    gadgetResource: string;
    filters: Filters;
    sortString?: string;
    interval?: number;
    maxRows?: number;
    timeout?: number;
}

export type TraceOutputValue = string | number | boolean | null;

export type TraceOutputItem = { [key: string]: TraceOutputValue };

export type ToVsCodeMsgDef = {
    getVersionRequest: void;
    deployRequest: void;
    undeployRequest: void;
    runStreamingTraceRequest: {
        traceId: number;
        arguments: GadgetArguments;
    };
    runBlockingTraceRequest: {
        traceId: number;
        arguments: GadgetArguments;
    };
    stopStreamingTraceRequest: void;
    getNodesRequest: void;
    getNamespacesRequest: void;
    getPodsRequest: {
        namespace: string;
    };
    getContainersRequest: {
        namespace: string;
        podName: string;
    };
};

export type ToWebViewMsgDef = {
    updateVersion: GadgetVersion;
    runTraceResponse: {
        traceId: number;
        items: TraceOutputItem[];
    };
    getNodesResponse: {
        nodes: string[];
    };
    getNamespacesResponse: {
        namespaces: string[];
    };
    getPodsResponse: {
        namespace: string;
        podNames: string[];
    };
    getContainersResponse: {
        namespace: string;
        podName: string;
        containerNames: string[];
    };
};

export type InspektorGadgetDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
