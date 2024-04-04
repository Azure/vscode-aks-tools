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

export interface NewRepositoryDialogProps {
    state: SingleDialogState<DraftDialogDefinition, "newRepository">;
    existingRepositories: string[];
    eventHandlers: EventHandlers<DraftDialogEventDef>;
    onSetNewAcrRepository: (repository: string) => void;
}

export function NewRepositoryDialog(props: NewRepositoryDialogProps) {
    function handleRepositoryChange(e: Event | FormEvent<HTMLElement>) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const content = { ...props.state.content, repository: getValidatedRepositoryName(name) };
        props.eventHandlers.onSetDialogContent({ dialog: "newRepository", content });
    }

    function getValidatedRepositoryName(name: string): Validatable<string> {
        if (!name) return missing("Repository name is required.");
        if (props.existingRepositories.includes(name)) return invalid(name, "Repository already exists.");

        return valid(name);
    }

    function validate(): Maybe<string> {
        if (!isValid(props.state.content.repository)) return nothing();

        return just(props.state.content.repository.value);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const repository = validate();
        if (isNothing(repository)) {
            return;
        }

        props.eventHandlers.onSetDialogVisibility({ dialog: "newRepository", shown: false });
        props.onSetNewAcrRepository(repository.value);
    }

    return (
        <Dialog
            isShown={props.state.shown}
            onCancel={() => props.eventHandlers.onSetDialogVisibility({ dialog: "newRepository", shown: false })}
        >
            <h2>New Repository</h2>

            <form onSubmit={handleSubmit}>
                <VSCodeDivider />

                <div className={styles.inputContainer}>
                    <label htmlFor="new-repository-input">Repository name *</label>
                    <VSCodeTextField
                        id="new-repository-input"
                        className={styles.control}
                        value={orDefault(props.state.content.repository, "")}
                        onBlur={handleRepositoryChange}
                        onInput={handleRepositoryChange}
                    />
                    {hasMessage(props.state.content.repository) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {props.state.content.repository.message}
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
                            props.eventHandlers.onSetDialogVisibility({ dialog: "newRepository", shown: false })
                        }
                    >
                        Cancel
                    </VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}
