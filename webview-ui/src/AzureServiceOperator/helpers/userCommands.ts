import { Message } from "../../../../src/webview-contract/messaging";

export type UserMsgDef = {
    setAppId: string | null
    setAppSecret: string | null
    setCheckingSP: void
    setSelectedSubscriptionId: string | null
    setInstallCertManagerStarted: void
    setWaitForCertManagerStarted: void
    setInstallOperatorStarted: void
    setInstallOperatorSettingsStarted: void
    setWaitForControllerManagerStarted: void
}

export type UserMessage = Message<UserMsgDef>;
