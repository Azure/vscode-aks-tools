import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kubectl.module.css";
import { EventHandlers } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";
import { AIKeyStatus } from "../../../src/webview-contract/webviewDefinitions/shared";
import { getWebviewMessageContext } from "../utilities/vscode";
import { OpenAIOutput } from "../components/OpenAIOutput";

export interface CommandOutputProps {
    isCommandRunning: boolean
    output: string | null
    errorMessage: string | null
    explanation: string | null
    isExplanationStreaming: boolean
    aiKeyStatus: AIKeyStatus
    invalidAIKey: string | null
    userMessageHandlers: EventHandlers<UserMsgDef>
}

export function CommandOutput(props: CommandOutputProps) {
    const vscode = getWebviewMessageContext<"kubectl">();
    const hasOutput = props.output !== undefined;
    const hasError = props.errorMessage !== undefined;

    return (
    <>
        {props.isCommandRunning && <VSCodeProgressRing />}
        {hasOutput && <pre>{props.output}</pre>}
        {hasError && <pre className={styles.error}>{props.errorMessage}</pre>}
        <OpenAIOutput
            vscode={vscode}
            explanation={props.explanation}
            isOutputStreaming={props.isExplanationStreaming}
            aiKeyStatus={props.aiKeyStatus}
            invalidAIKey={props.invalidAIKey}
            userMessageHandlers={props.userMessageHandlers}
        />
    </>
    );
}