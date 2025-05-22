import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FormEvent, useState } from "react";
import { Dialog } from "../components/Dialog";
import { Validatable, hasMessage, invalid, isValid, isValueSet, unset, valid } from "../utilities/validation";
import styles from "./CreateCluster.module.css";
import * as l10n from "@vscode/l10n";

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
        if (!name) return invalid(name, l10n.t("Resource Group name must be at least 1 character long."));
        if (name.length > 90) return invalid(name, l10n.t("Resource Group name must be at most 90 characters long."));
        if (!/[\p{Letter}0-9_\-.()]+/u.test(name)) {
            return invalid(name, l10n.t("Resource Group name contains invalid characters."));
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
            <h2>{l10n.t("New Resource Group")}</h2>

            <form className={styles.createForm} onSubmit={handleSubmit}>
                <div className={styles.inputContainer}>
                    <label htmlFor="rg-name-input" className={styles.label}>
                        {l10n.t("Name*")}
                    </label>
                    <input
                        type="text"
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
                    <button type="submit">{l10n.t("Create")}</button>
                    <button onClick={props.onCancel}>{l10n.t("Cancel")}</button>
                </div>
            </form>
        </Dialog>
    );
}
