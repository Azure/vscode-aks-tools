import { FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { VSCodeButton, VSCodeDivider, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "../Draft.module.css";
import { EventHandlers } from "../../utilities/state";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import { SingleDialogState } from "../../utilities/dialogState";
import { Validatable, hasMessage, invalid, isValid, missing, orDefault, valid } from "../../utilities/validation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { DraftDialogDefinition, DraftDialogEventDef } from "./dialogState";

export interface NewNamespaceDialogProps {
    state: SingleDialogState<DraftDialogDefinition, "newClusterNamespace">;
    existingNamespaces: string[];
    eventHandlers: EventHandlers<DraftDialogEventDef>;
    onSetNewClusterNamespace: (namespace: string) => void;
}

export function NewNamespaceDialog(props: NewNamespaceDialogProps) {
    function handleNamespaceChange(e: Event | FormEvent<HTMLElement>) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const content = { ...props.state.content, namespace: getValidatedNamespace(name) };
        props.eventHandlers.onSetDialogContent({ dialog: "newClusterNamespace", content });
    }

    function getValidatedNamespace(name: string): Validatable<string> {
        if (!name) return missing("Namespace is required.");
        if (props.existingNamespaces.includes(name)) return invalid(name, "Namespace already exists.");

        return valid(name);
    }

    function validate(): Maybe<string> {
        if (!isValid(props.state.content.namespace)) return nothing();

        return just(props.state.content.namespace.value);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const namespace = validate();
        if (isNothing(namespace)) {
            return;
        }

        props.eventHandlers.onSetDialogVisibility({ dialog: "newClusterNamespace", shown: false });
        props.onSetNewClusterNamespace(namespace.value);
    }

    return (
        <Dialog
            isShown={props.state.shown}
            onCancel={() => props.eventHandlers.onSetDialogVisibility({ dialog: "newClusterNamespace", shown: false })}
        >
            <h2>New Namespace</h2>

            <form onSubmit={handleSubmit}>
                <VSCodeDivider />

                <div className={styles.inputContainer}>
                    <label htmlFor="new-namespace-input">Namespace *</label>
                    <VSCodeTextField
                        id="new-namespace-input"
                        className={styles.control}
                        value={orDefault(props.state.content.namespace, "")}
                        onBlur={handleNamespaceChange}
                        onInput={handleNamespaceChange}
                    />
                    {hasMessage(props.state.content.namespace) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {props.state.content.namespace.message}
                        </span>
                    )}
                </div>

                <VSCodeDivider />

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit" disabled={isNothing(validate())}>
                        Save
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="secondary"
                        onClick={() =>
                            props.eventHandlers.onSetDialogVisibility({ dialog: "newClusterNamespace", shown: false })
                        }
                    >
                        Cancel
                    </VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}
