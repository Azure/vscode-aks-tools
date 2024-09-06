import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
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

export type CreatedCluster = {
    portalUrl: string;
};

export interface CreateClusterParams {
    isNewResourceGroup: boolean;
    resourceGroupName: string;
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
        deploymentPortalUrl: string | null;
        createdCluster: CreatedCluster | null;
    };
};

export type CreateClusterDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
