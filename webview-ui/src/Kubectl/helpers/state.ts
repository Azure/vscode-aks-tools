import { PresetCommand, ToWebViewMsgDef, presetCommands } from "../../../../src/webview-contract/webviewDefinitions/kubectl"
import { StateMessageHandler, chainStateUpdaters, toStateUpdater } from "../../utilities/state"
import { UserMsgDef } from "./userCommands"

export interface KubectlState {
    initializationStarted: boolean
    allCommands: PresetCommand[]
    selectedCommand: string | null
    isCommandRunning: boolean
    output: string | null
    errorMessage: string | null
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
        isSaveDialogShown: false
    };
}

export const vscodeMessageHandler: StateMessageHandler<ToWebViewMsgDef, KubectlState> = {
    runCommandResponse: (state, args) => ({...state, output: args.output, errorMessage: args.errorMessage, explanation: null, isCommandRunning: false})
}

export const userMessageHandler: StateMessageHandler<UserMsgDef, KubectlState> = {
    setInitializing: (state, _args) => ({...state, initializationStarted: true}),
    setSelectedCommand: (state, args) => ({...state, selectedCommand: args.command, output: null, errorMessage: null, explanation: null}),
    setAllCommands: (state, args) => ({...state, allCommands: args.allCommands}),
    setCommandRunning: (state, _args) => ({...state, isCommandRunning: true, output: null, errorMessage: null, explanation: null}),
    setSaveDialogVisibility: (state, args) => ({...state, isSaveDialogShown: args.shown})
}

export const updateState = chainStateUpdaters(
    toStateUpdater(vscodeMessageHandler),
    toStateUpdater(userMessageHandler));
