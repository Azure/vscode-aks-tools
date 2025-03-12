import { WebviewDefinition } from "../webviewTypes";
import { HubMode } from "./createFleet";

export interface InitialState {
    fleetName: string;
}

export type FleetInfo = {
    resourceGroup: string;
    provisioningState: string;
    location: string;
    hubClusterMode: HubMode;
    fqdn: undefined | string;
};

export type ToVsCodeMsgDef = {
    getPropertiesRequest: void;
    refreshRequest: void;
};

export type ToWebViewMsgDef = {
    getPropertiesResponse: FleetInfo;
    errorNotification: string;
};

export type FleetProperties = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
