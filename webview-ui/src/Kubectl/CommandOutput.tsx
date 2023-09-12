import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kubectl.module.css";

export interface CommandOutputProps {
    isCommandRunning: boolean
    output?: string
    errorMessage?: string
    explanation?: string
}

export function CommandOutput(props: CommandOutputProps) {
    const hasOutput = props.output !== undefined;
    const hasError = props.errorMessage !== undefined;
    const hasExplanation = props.explanation !== undefined;

    return (
    <>
        {props.isCommandRunning && <VSCodeProgressRing />}
        {hasOutput && <pre>{props.output}</pre>}
        {hasError && <pre className={styles.error}>{props.errorMessage}</pre>}
        {hasExplanation && <pre>{props.explanation}</pre>}
    </>
    );
}