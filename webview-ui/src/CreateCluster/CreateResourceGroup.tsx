import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FormEvent, useState } from "react";
import { ResourceGroup } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Dialog } from "../components/Dialog";
import { Validatable, createHandler, shouldShowMessage, unset } from "../utilities/validation";
import styles from "./CreateCluster.module.css";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CreateResourceGroupDialogProps {
    isShown: boolean;
    locations: string[];
    onCancel: () => void;
    onAccept: (group: ResourceGroup) => void;
}

export function CreateResourceGroupDialog(props: CreateResourceGroupDialogProps) {
    const [name, setName] = useState<Validatable<string>>(unset());

    const handleNameChange = createHandler<string, ChangeEvent, HTMLInputElement>(
        (e) => e.currentTarget as HTMLInputElement,
        (elem) => elem.value || null,
        (elem) => elem.checkValidity(),
        (elem) =>
            elem.validity.patternMismatch
                ? "Resource Group name contains invalid characters."
                : elem.validity.tooShort
                  ? "Resource Group name must be at least 1 character long."
                  : elem.validity.tooLong
                    ? "Resource Group name must be at most 90 characters long."
                    : elem.validity.valueMissing
                      ? "Resource Group name is required."
                      : "Invalid Resource Group name.",
        setName,
    );

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        props.onAccept({
            name: name.value!,
            location: "", //location is set in the CreateClusterInput component
        });
    }

    return (
        <Dialog isShown={props.isShown} onCancel={() => props.onCancel()}>
            <h2>New Resource Group</h2>

            <form className={styles.createForm} onSubmit={handleSubmit}>
                <div className={styles.inputContainer}>
                    <label htmlFor="rg-name-input" className={styles.label}>
                        Name*
                    </label>
                    <VSCodeTextField
                        id="rg-name-input"
                        value={name.value || ""}
                        className={`${styles.longControl} ${styles.validatable}`}
                        required
                        minlength={1}
                        maxlength={90}
                        pattern="[\p{Letter}0-9_\-\.\(\)]+"
                        onBlur={handleNameChange}
                        onInput={handleNameChange}
                    />
                    {shouldShowMessage(name) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {name.message}
                        </span>
                    )}
                </div>

                <div className={styles.buttonContainer} style={{ justifyContent: "flex-end" }}>
                    <VSCodeButton type="submit">Create</VSCodeButton>
                    <VSCodeButton onClick={props.onCancel}>Cancel</VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}
