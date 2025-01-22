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

export type CreatedFleet = {
    portalUrl: string;
};

export interface CreateFleetParams {
    resourceGroupName: string;
    location: string;
    name: string;
}

export type ToVsCodeMsgDef = {
    getLocationsRequest: void;
    getResourceGroupsRequest: void;
    createFleetRequest: CreateFleetParams;
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
        createdFleet: CreatedFleet | null;
    };
};

export type CreateFleetDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
