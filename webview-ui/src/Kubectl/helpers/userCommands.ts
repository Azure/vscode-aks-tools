import { Message } from "../../../../src/webview-contract/messaging"
import { PresetCommand } from "../../../../src/webview-contract/webviewDefinitions/kubectl"
import { AIUserMsgDef } from "../../utilities/openai"

export type UserMsgDef = AIUserMsgDef & {
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
    }
}

export type UserMessage = Message<UserMsgDef>;
