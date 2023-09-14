import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kubectl.module.css";
import { OpenAIOutput } from "./OpenAIOutput";
import { AIKeyStatus } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import { EventHandlers } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";

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
    const hasOutput = props.output !== undefined;
    const hasError = props.errorMessage !== undefined;

    return (
    <>
        {props.isCommandRunning && <VSCodeProgressRing />}
        {hasOutput && <pre>{props.output}</pre>}
        {hasError && <pre className={styles.error}>{props.errorMessage}</pre>}
        <OpenAIOutput
            explanation={props.explanation}
            isExplanationStreaming={props.isExplanationStreaming}
            aiKeyStatus={props.aiKeyStatus}
            invalidAIKey={props.invalidAIKey}
            userMessageHandlers={props.userMessageHandlers}
        />
    </>
    );
}