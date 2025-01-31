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
    hubMode: HubMode;
    dnsPrefix: string | null; // required, if hubMode is "With"
}

// Fleet resource can be created with or without a hub cluster.
// A hub cluster is a managed cluster that acts as a hub to store and propagate Kubernetes resources.
// More Info: https://learn.microsoft.com/en-us/azure/kubernetes-fleet/concepts-choosing-fleet
export enum HubMode {
    Without,
    With,
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
