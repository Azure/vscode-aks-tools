import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export type EventDef = {
    //Defines the events that can originate from the webview and be sent to the backend (ToVsCodeMsgDef).
    draftValidateRequest: string; //TODO Proper value //This represents a message from the webview to request a draft validation.
};

export type DraftValidateState = {
    //Defines the shape of the state for the draftValidate webview.
    validationResults: string;
};

export const stateUpdater: WebviewStateUpdater<"draftValidate", EventDef, DraftValidateState> = {
    createState: (initialState) => ({
        validationResults: initialState.validationResults,
    }),
    vscodeMessageHandler: {
        // This handler updates the state when a message from the extension
        // with the name 'getValidationResult' arrives.
        validationResult: (state, response) => ({
            ...state,
            validationResults: response.result,
        }),
    },
    eventHandler: {
        //There are no user triggered events and thus don't need to define any event handlers.
        //Defines handlers for events triggered within the webview (ToVsCodeMsgDef)
        draftValidateRequest: (state) => ({
            ...state,
        }),
    },
};

export const vscode = getWebviewMessageContext<"draftValidate">({
    createDraftValidateRequest: null, //inside of ToVsCodeMsgDef
});
