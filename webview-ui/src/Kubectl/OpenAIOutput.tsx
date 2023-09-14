import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kubectl.module.css";
import { FormEvent, useState } from "react";
import { getWebviewMessageContext } from "../utilities/vscode";
import { AIKeyStatus } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import { EventHandlers } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface OpenAIOutputProps {
    explanation: string | null
    isExplanationStreaming: boolean
    aiKeyStatus: AIKeyStatus
    invalidAIKey: string | null
    userMessageHandlers: EventHandlers<UserMsgDef>
}

export function OpenAIOutput(props: OpenAIOutputProps) {
    const vscode = getWebviewMessageContext<"kubectl">();

    const [apiKey, setApiKey] = useState<string>("");

    function handleAPIKeyChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        setApiKey(input.value);
    }

    function handleUpdateClick() {
        vscode.postMessage({ command: "updateAIKeyRequest", parameters: {apiKey} });
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