import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export type EventDef = {
    //Defines the events that can originate from the webview and be sent to the backend (ToVsCodeMsgDef).
    draftValidateRequest: string;
};

export type DraftValidateState = {
    validationResults: string;
};

export const stateUpdater: WebviewStateUpdater<"draftValidate", EventDef, DraftValidateState> = {
    createState: (initialState) => ({
        validationResults: initialState.validationResults,
    }),
    vscodeMessageHandler: {
        // This handler updates the state when a message from the extension
        validationResult: (state, response) => ({
            ...state,
            validationResults: response.result,
        }),
    },
    eventHandler: {
        draftValidateRequest: (state) => ({
            ...state,
        }),
    },
};

export const vscode = getWebviewMessageContext<"draftValidate">({
    createDraftValidateRequest: null,
});
