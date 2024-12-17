import { WebviewDefinition } from "../../webviewTypes";

export interface InitialState {
    validationResults: string;
}

export type ExistingFiles = string[];

export type ToVsCodeMsgDef = {
    createDraftValidateRequest: string;
};

export type ToWebViewMsgDef = {
    validationResult: { result: string };
};

export type DraftValidateDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
