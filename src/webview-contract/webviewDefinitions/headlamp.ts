import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    deploymentStatus: string;
    token: string;
}

export type ToVsCodeMsgDef = {
    deployHeadlampRequest: void;
    generateTokenRequest: void;
    startPortForwardingRequest: void;
    stopPortForwardingRequest: void;
};

export type ToWebViewMsgDef = {
    headlampUpdate: {
        deploymentStatus: string;
        token: string;
    };
};

export type HeadlampDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
