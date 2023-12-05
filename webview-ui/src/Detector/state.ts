import { InitialState } from "../../../src/webview-contract/webviewDefinitions/detector";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type DetectorState = InitialState;

export const stateUpdater: WebviewStateUpdater<"detector", EventDef, DetectorState> = {
    createState: (initialState) => ({ ...initialState }),
    vscodeMessageHandler: {},
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"detector">({});
