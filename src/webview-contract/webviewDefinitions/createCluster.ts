import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    portalUrl: string;
    portalReferrerContext: string;
    subscriptionId: string;
    subscriptionName: string;
}

export interface ResourceGroup {
    name: string;
    location: string;
}

export enum ProgressEventType {
    InProgress,
    Cancelled,
    Failed,
    Success,
}

export interface CreateClusterParams {
    isNewResourceGroup: boolean;
    resourceGroup: ResourceGroup;
    location: string;
    name: string;
    preset: Preset;
}

// NOTE: This is intented to be a union of Preset strings, but for now we only have one.
export type Preset = "dev";

export type ToVsCodeMsgDef = {
    getLocationsRequest: void;
    getResourceGroupsRequest: void;
    createClusterRequest: CreateClusterParams;
};

export type ToWebViewMsgDef = {
    getLocationsResponse: {
        locations: string[];
    };
    getResourceGroupsResponse: {
        groups: ResourceGroup[];
    };
    progressUpdate: {
        operationDescription: string;
        event: ProgressEventType;
        errorMessage: string | null;
    };
};

export type CreateClusterDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
