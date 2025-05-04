import { getWebviewMessageContext } from "../utilities/vscode";
import { WebviewStateUpdater } from "../utilities/state";

export const vscode = getWebviewMessageContext<"headlamp">({
    deployHeadlampRequest: null,
    generateTokenRequest: null,
    startPortForwardingRequest: null,
    stopPortForwardingRequest: null,
});

export type EventDef = Record<string, never>;

export type HeadlampState = {
    deploymentStatus: string;
    token: string;
};

export const stateUpdater: WebviewStateUpdater<"headlamp", EventDef, HeadlampState> = {
    createState: (initialState) => ({
        ...initialState,
    }),
    vscodeMessageHandler: {
        headlampUpdate: (state, args) => ({
            ...state,
            deploymentStatus: args.deploymentStatus,
            token: args.token,
        }),
    },
    eventHandler: {},
};
