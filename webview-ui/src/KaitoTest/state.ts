import { getWebviewMessageContext } from "../utilities/vscode";
import { WebviewStateUpdater } from "../utilities/state";

export const vscode = getWebviewMessageContext<"kaitoTest">({
    queryRequest: null,
});

export type EventDef = Record<string, never>;

export type TestState = {
    clusterName: string;
    modelName: string;
    output: string;
};

export const stateUpdater: WebviewStateUpdater<"kaitoTest", EventDef, TestState> = {
    createState: (initialState) => ({
        ...initialState,
    }),
    vscodeMessageHandler: {
        testUpdate: (state, args) => ({
            ...state,
            modelName: args.modelName,
            output: args.output,
        }),
    },
    eventHandler: {},
};
