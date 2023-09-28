import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "./OpenAIOutput.module.css";
import { FormEvent, useState } from "react";
import { AIKeyStatus, AIToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/shared";
import { EventHandlers } from "../utilities/state";
import { AIUserMsgDef } from "../utilities/openai";
import { MessageSink } from "../../../src/webview-contract/messaging";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface OpenAIOutputProps {
    vscode: MessageSink<AIToVsCodeMsgDef>
    explanation: string | null
    isOutputStreaming: boolean
    aiKeyStatus: AIKeyStatus
    invalidAIKey: string | null
    userMessageHandlers: EventHandlers<AIUserMsgDef>
}

export function OpenAIOutput(props: OpenAIOutputProps) {
    const [apiKey, setApiKey] = useState<string>("");

    function handleAPIKeyChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        setApiKey(input.value);
    }

    function handleUpdateClick() {
        props.vscode.postMessage({ command: "updateAIKeyRequest", parameters: {apiKey} });
        props.userMessageHandlers.onSetAPIKeySaved();
    }

    const canUpdate = apiKey && apiKey.trim() && apiKey.trim() !== props.invalidAIKey;
    const needsNewAIKey = props.aiKeyStatus === AIKeyStatus.Missing || props.aiKeyStatus === AIKeyStatus.Invalid;

    return (
        <>
            {needsNewAIKey && (
                <div>
                    {props.aiKeyStatus === AIKeyStatus.Invalid && <p>OpenAI API Key is invalid</p>}
                    {props.aiKeyStatus === AIKeyStatus.Missing && <p>OpenAI API Key is not set</p>}
                    <div className={styles.labelTextButton}>
                        <label htmlFor="api-key-input">API Key:</label>
                        <VSCodeTextField id="api-key-input" value={apiKey} onInput={handleAPIKeyChange} />
                        <VSCodeButton disabled={!canUpdate} onClick={handleUpdateClick}>{props.invalidAIKey ? 'Update' : 'Set'}</VSCodeButton>
                    </div>
                </div>
            )}
            {props.explanation && <pre className={styles.explanation}>{props.explanation}</pre>}
        </>
    )
}