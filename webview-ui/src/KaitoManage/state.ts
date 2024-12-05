import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";
import { ModelState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";

export type EventDef = Record<string, never>;

export type MonitorState = {
    clusterName: string;
    models: ModelState[];
};

export const vscode = getWebviewMessageContext<"kaitoManage">({
    monitorUpdateRequest: null,
    deleteWorkspaceRequest: null,
    redeployWorkspaceRequest: null,
    getLogsRequest: null,
    testWorkspaceRequest: null,
});

export const stateUpdater: WebviewStateUpdater<"kaitoManage", EventDef, MonitorState> = {
    createState: (initialState) => ({
        ...initialState,
    }),
    vscodeMessageHandler: {
        monitorUpdate: (state, args) => ({
            ...state,
            models: args.models,
        }),
    },
    eventHandler: {},
};
