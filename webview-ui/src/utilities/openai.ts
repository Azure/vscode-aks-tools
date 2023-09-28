import { AIKeyStatus, AIToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/shared"
import { StateMessageHandler } from "./state"

export type AIUserMsgDef = {
    setAPIKeySaved: void
}

export interface AIState {
    aiResponse: string | null
    aiError: string | null
    isAIResponseStreaming: boolean
    aiKeyStatus: AIKeyStatus
    invalidAIKey: string | null
}

export function createAIState(): AIState {
    return {
        aiResponse: null,
        aiError: null,
        isAIResponseStreaming: false,
        aiKeyStatus: AIKeyStatus.Unverified,
        invalidAIKey: null
    };
}

export function getAIVscodeMessageHandler<TState extends AIState>(): StateMessageHandler<AIToWebViewMsgDef, TState> {
    return {
        startAIResponse: (state, _args) => ({...state, isAIResponseStreaming: true}),
        errorStreamingAIResponse: (state, args) => ({...state, aiError: args.error}),
        appendAIResponse: (state, args) => ({...state, aiResponse: (state.aiResponse || "") + args.chunk}),
        completeAIResponse: (state, _args) => ({...state, isAIResponseStreaming: false}),
        updateAIKeyStatus: (state, args) => ({...state, aiKeyStatus: args.keyStatus, invalidAIKey: args.invalidKey})
    };
}

export function getAIUserMessageHandler<TState extends AIState>(): StateMessageHandler<AIUserMsgDef, TState> {
    return {
        setAPIKeySaved: (state, _args) => ({...state, aiKeyStatus: AIKeyStatus.Unverified, invalidAIKey: null})
    };
};
