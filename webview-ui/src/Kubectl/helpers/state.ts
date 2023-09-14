import { AIKeyStatus, PresetCommand, ToWebViewMsgDef, presetCommands } from "../../../../src/webview-contract/webviewDefinitions/kubectl"
import { StateMessageHandler, chainStateUpdaters, toStateUpdater } from "../../utilities/state"
import { UserMsgDef } from "./userCommands"

export interface KubectlState {
    initializationStarted: boolean
    allCommands: PresetCommand[]
    selectedCommand: string | null
    isCommandRunning: boolean
    output: string | null
    errorMessage: string | null
    explanation: string | null
    isExplanationStreaming: boolean
    aiKeyStatus: AIKeyStatus
    invalidAIKey: string | null
    isSaveDialogShown: boolean
}

export function createState(customCommands: PresetCommand[]): KubectlState {
    return {
        initializationStarted: false,
        allCommands: [...presetCommands, ...customCommands],
        selectedCommand: null,
        isCommandRunning: false,
        output: null,
        errorMessage: null,
        explanation: null,
        isExplanationStreaming: false,
        aiKeyStatus: AIKeyStatus.Unverified,
        invalidAIKey: null,
        isSaveDialogShown: false
    };
}

export const vscodeMessageHandler: StateMessageHandler<ToWebViewMsgDef, KubectlState> = {
    runCommandResponse: (state, args) => ({...state, output: args.output, errorMessage: args.errorMessage, explanation: null, isCommandRunning: false}),
    startExplanation: (state, _args) => ({...state, isExplanationStreaming: true}),
    errorStreamingExplanation: (state, args) => {
        console.error(args.error);
        return state;
    },
    appendExplanation: (state, args) => ({...state, explanation: (state.explanation || "") + args.chunk}),
    completeExplanation: (state, _args) => ({...state, isExplanationStreaming: false}),
    updateAIKeyStatus: (state, args) => ({...state, aiKeyStatus: args.keyStatus, invalidAIKey: args.invalidKey})
}

export const userMessageHandler: StateMessageHandler<UserMsgDef, KubectlState> = {
    setInitializing: (state, _args) => ({...state, initializationStarted: true}),
    setSelectedCommand: (state, args) => ({...state, selectedCommand: args.command, output: null, errorMessage: null, explanation: null}),
    setAllCommands: (state, args) => ({...state, allCommands: args.allCommands}),
    setCommandRunning: (state, _args) => ({...state, isCommandRunning: true, output: null, errorMessage: null, explanation: null}),
    setSaveDialogVisibility: (state, args) => ({...state, isSaveDialogShown: args.shown}),
    setAPIKeySaved: (state, _args) => ({...state, aiKeyStatus: AIKeyStatus.Unverified, invalidAIKey: null})
}

export const updateState = chainStateUpdaters(
    toStateUpdater(vscodeMessageHandler),
    toStateUpdater(userMessageHandler));
