import { InitialState, ProgressEventType } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type KaitoState = InitialState & {
    operationDescription: string;
    kaitoInstallStatus: ProgressEventType;
    errors: string | undefined;
};

export const stateUpdater: WebviewStateUpdater<"kaito", EventDef, KaitoState> = {
    createState: (initialState) => ({
        ...initialState,
        operationDescription: "",
        kaitoInstallStatus: ProgressEventType.NotStarted,
        errors: undefined,
    }),
    vscodeMessageHandler: {
        kaitoInstallProgressUpdate: (state, args) => ({
            ...state,
            operationDescription: args.operationDescription,
            kaitoInstallStatus: args.event,
            errors: args.errorMessage,
        }),
        getWorkspaceResponse: (state, args) => ({
            ...state,
            workspace: args.workspace,
        }),
    },
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"kaito">({
    installKaitoRequest: null,
    generateWorkspaceRequest: null,
});
