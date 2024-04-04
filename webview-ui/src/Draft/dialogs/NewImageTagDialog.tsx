import { FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { VSCodeButton, VSCodeDivider, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "../Draft.module.css";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import { SingleDialogState } from "../../utilities/dialogState";
import { Validatable, hasMessage, invalid, isValid, missing, orDefault, valid } from "../../utilities/validation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { DraftDialogDefinition, DraftDialogEventDef } from "./dialogState";
import { EventHandlers } from "../../utilities/state";

export interface NewImageTagDialogProps {
    state: SingleDialogState<DraftDialogDefinition, "newImageTag">;
    existingTags: string[];
    eventHandlers: EventHandlers<DraftDialogEventDef>;
    onSetNewAcrRepoTag: (tag: string) => void;
}

export function NewImageTagDialog(props: NewImageTagDialogProps) {
    function handleImageTagChange(e: Event | FormEvent<HTMLElement>) {
        const tag = (e.currentTarget as HTMLInputElement).value;
        const content = { ...props.state.content, imageTag: getValidatedImageTag(tag) };
        props.eventHandlers.onSetDialogContent({ dialog: "newImageTag", content });
    }

    function getValidatedImageTag(tag: string): Validatable<string> {
        if (!tag) return missing("Image tag name is required.");
        if (props.existingTags.includes(tag)) return invalid(tag, "Image tag already exists.");

        return valid(tag);
    }

    function validate(): Maybe<string> {
        if (!isValid(props.state.content.imageTag)) return nothing();

        return just(props.state.content.imageTag.value);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const tag = validate();
        if (isNothing(tag)) {
            return;
        }

        props.eventHandlers.onSetDialogVisibility({ dialog: "newImageTag", shown: false });
        props.onSetNewAcrRepoTag(tag.value);
    }

    return (
        <Dialog
            isShown={props.state.shown}
            onCancel={() => props.eventHandlers.onSetDialogVisibility({ dialog: "newImageTag", shown: false })}
        >
            <h2>New Image Tag</h2>

            <form onSubmit={handleSubmit}>
                <VSCodeDivider />

                <div className={styles.inputContainer}>
                    <label htmlFor="new-tag-input">Tag *</label>
                    <VSCodeTextField
                        id="new-tag-input"
                        className={styles.control}
                        value={orDefault(props.state.content.imageTag, "")}
                        onBlur={handleImageTagChange}
                        onInput={handleImageTagChange}
                    />
                    {hasMessage(props.state.content.imageTag) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {props.state.content.imageTag.message}
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
                            props.eventHandlers.onSetDialogVisibility({ dialog: "newImageTag", shown: false })
                        }
                    >
                        Cancel
                    </VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}
