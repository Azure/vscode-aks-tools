import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type RetinaState = InitialState;

export const stateUpdater: WebviewStateUpdater<"retinaCapture", EventDef, RetinaState> = {
    createState: (initialState) => ({
        ...initialState
    }),
    vscodeMessageHandler: {},
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"retinaCapture">({
    retinaCaptureResult: undefined,
    getAllNodes: undefined,
    handleCaptureFileDownload: undefined,
});
