import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    isVSCode: boolean;
}

export interface CssRule {
    selector: string;
    text: string;
}

export type ToVsCodeMsgDef = {
    reportCssVars: {
        cssVars: string[];
    };
    reportCssRules: {
        rules: CssRule[];
    };
};

export type ToWebViewMsgDef = Record<string, never>;

export type TestStyleViewerDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
