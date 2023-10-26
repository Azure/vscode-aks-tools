import { CssRule, InitialState } from "../../../src/webview-contract/webviewDefinitions/testStyleViewer";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type State = InitialState & {
    cssVars: string[],
    cssRules: CssRule[]
};

export type EventDef = {
    cssVarsUpdate: string[],
    cssRulesUpdate: CssRule[]
};

export const stateUpdater: WebviewStateUpdater<"style", EventDef, State> = {
    createState: initialState => ({
        ...initialState,
        cssVars: [],
        cssRules: []
    }),
    vscodeMessageHandler: {},
    eventHandler: {
        cssVarsUpdate: (state, cssVars) => ({...state, cssVars}),
        cssRulesUpdate: (state, cssRules) => ({...state, cssRules})
    }
};

export const vscode = getWebviewMessageContext<"style">({
    reportCssRules: null,
    reportCssVars: null
});