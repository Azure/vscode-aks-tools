import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FormEvent, useState } from "react";
import { Dialog } from "../components/Dialog";
import { Validatable, hasMessage, invalid, isValid, isValueSet, unset, valid } from "../utilities/validation";
import styles from "./CreateCluster.module.css";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CreateResourceGroupDialogProps {
    isShown: boolean;
    locations: string[];
    onCancel: () => void;
    onAccept: (groupName: string) => void;
}

export function CreateResourceGroupDialog(props: CreateResourceGroupDialogProps) {
    const [name, setName] = useState<Validatable<string>>(unset());

    function getValidatedName(name: string): Validatable<string> {
        if (!name) return invalid(name, "Resource Group name must be at least 1 character long.");
        if (name.length > 90) return invalid(name, "Resource Group name must be at most 90 characters long.");
        if (!/[\p{Letter}0-9_\-.()]+/u.test(name)) {
            return invalid(name, "Resource Group name contains invalid characters.");
        }

        return valid(name);
    }

    function handleNameChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLInputElement;
        const validated = getValidatedName(elem.value);
        setName(validated);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();

        // This check might be redundant based on the way validation works, but let's check this explicitly:
        if (!isValid(name)) {
            return;
        }

        props.onAccept(name.value);
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
                        value={isValueSet(name) ? name.value : ""}
                        className={`${styles.longControl} ${styles.validatable}`}
                        onBlur={handleNameChange}
                        onInput={handleNameChange}
                    />
                    {hasMessage(name) && (
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
