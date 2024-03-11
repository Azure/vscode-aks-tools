import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kubectl.module.css";
import { FormEvent } from "react";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CommandInputProps {
    command: string;
    matchesExisting: boolean;
    onCommandUpdate: (command: string) => void;
    onRunCommand: (command: string) => void;
    onSaveRequest: () => void;
}

export function CommandInput(props: CommandInputProps) {
    function handleCommandChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        props.onCommandUpdate(input.value);
    }

    function onKeyPress(e: React.KeyboardEvent<HTMLElement>) {
        if (e.nativeEvent instanceof KeyboardEvent) {
            if (e.code === "Enter") {
                props.onRunCommand(props.command);
            }
        }
    }

    const canRun = props.command.trim().length > 0;
    return (
        <div className={styles.inputContainer}>
            <label htmlFor="command-input" className={styles.label}>
                Command
            </label>
            <VSCodeTextField
                id="command-input"
                className={styles.control}
                value={props.command}
                onInput={handleCommandChange}
                onKeyUp={onKeyPress}
            />
            <div className={styles.commands}>
                <VSCodeButton disabled={!canRun} onClick={() => props.onRunCommand(props.command)}>
                    Run
                </VSCodeButton>
                {!props.matchesExisting && <VSCodeButton onClick={props.onSaveRequest}>Save</VSCodeButton>}
            </div>
        </div>
    );
}
