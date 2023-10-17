import { InitialState, PresetCommand, presetCommands } from "../../../../src/webview-contract/webviewDefinitions/kubectl";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export type KubectlState = InitialState & {
    allCommands: PresetCommand[]
    selectedCommand: string | null
    isCommandRunning: boolean
    output: string | null
    errorMessage: string | null
    isSaveDialogShown: boolean
};

export type EventDef = {
    setSelectedCommand: {
        command: string
    },
    setAllCommands: {
        allCommands: PresetCommand[]
    },
    setCommandRunning: void,
    setSaveDialogVisibility: {
        shown: boolean
    }
};

export const stateUpdater: WebviewStateUpdater<"kubectl", EventDef, KubectlState> = {
    createState: initialState => ({
        ...initialState,
        allCommands: [...presetCommands, ...initialState.customCommands],
        selectedCommand: null,
        isCommandRunning: false,
        output: null,
        errorMessage: null,
        isSaveDialogShown: false
    }),
    vscodeMessageHandler: {
        runCommandResponse: (state, args) => ({...state, output: args.output, errorMessage: args.errorMessage, explanation: null, isCommandRunning: false})
    },
    eventHandler: {
        setSelectedCommand: (state, args) => ({...state, selectedCommand: args.command, output: null, errorMessage: null, explanation: null}),
        setAllCommands: (state, args) => ({...state, allCommands: args.allCommands}),
        setCommandRunning: (state, _args) => ({...state, isCommandRunning: true, output: null, errorMessage: null, explanation: null}),
        setSaveDialogVisibility: (state, args) => ({...state, isSaveDialogShown: args.shown})
    }
};

export const vscode = getWebviewMessageContext<"kubectl">({
    addCustomCommandRequest: null,
    deleteCustomCommandRequest: null,
    runCommandRequest: null
});