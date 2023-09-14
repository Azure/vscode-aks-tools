import { Message } from "../../../../src/webview-contract/messaging"
import { PresetCommand } from "../../../../src/webview-contract/webviewDefinitions/kubectl"

export type UserMsgDef = {
    setInitializing: void,
    setSelectedCommand: {
        command: string
    },
    setAllCommands: {
        allCommands: PresetCommand[]
    },
    setCommandRunning: void,
    setSaveDialogVisibility: {
        shown: boolean
    },
    setAPIKeySaved: void
}

export type UserMessage = Message<UserMsgDef>;
