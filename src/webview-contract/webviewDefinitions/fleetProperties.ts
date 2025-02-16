import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    fleetName: string;
}

export type FleetInfo = {
    provisioningState: string;
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
