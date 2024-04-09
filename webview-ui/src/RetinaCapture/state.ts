import { CommandResult, InitialState, ValueCommandResult } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type RetinaState = InitialState;

export const stateUpdater: WebviewStateUpdater<"retinaCapture", EventDef, RetinaState> = {
    createState: (initialState) => ({ ...initialState }),
    vscodeMessageHandler: {
        startCaptureResponse: function (state: InitialState, msg: string): InitialState {
            console.log(msg);
            console.log(state);
            throw new Error("Function not implemented.");
        },
        getAllNodesResponse: function (state: InitialState, msg: ValueCommandResult<CommandResult, string[]>): InitialState {
            console.log(msg);
            console.log(state);
            throw new Error("Function not implemented.");
        }
    },
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"retinaCapture">({
    retinaCaptureResult: undefined,
    getAllNodes: undefined
});
