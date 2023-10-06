import { Message } from "../../../../src/webview-contract/messaging";
import { CreateClusterParams } from "../../../../src/webview-contract/webviewDefinitions/createCluster";

export type UserMsgDef = {
    setInitializing: void,
    setInitialized: void,
    setCreating: {
        parameters: CreateClusterParams
    }
}

export type UserMessage = Message<UserMsgDef>;
