import { FormEvent, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { Validatable, createHandler, shouldShowMessage, unset } from "../utilities/validation";
import styles from "./CreateCluster.module.css";
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { Dialog } from "../components/Dialog";
import { ResourceGroup } from "../../../src/webview-contract/webviewDefinitions/createCluster";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CreateResourceGroupDialogProps {
    isShown: boolean;
    locations: string[];
    onCancel: () => void;
    onAccept: (group: ResourceGroup) => void;
}

export function CreateResourceGroupDialog(props: CreateResourceGroupDialogProps) {
    const [name, setName] = useState<Validatable<string>>(unset());
    const [location, setLocation] = useState<Validatable<string>>(unset());

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

    const handleLocationChange = createHandler<string, ChangeEvent, HTMLSelectElement>(
        (e) => e.currentTarget as HTMLSelectElement,
        (elem) => (elem.selectedIndex <= 0 ? null : props.locations[elem.selectedIndex - 1]),
        (elem) => elem.checkValidity(),
        () => "Location is required.",
        setLocation,
    );

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        props.onAccept({
            name: name.value!,
            location: location.value!,
        });
    }

    return (
        <Dialog isShown={props.isShown} onCancel={() => props.onCancel()}>
            <h2>New Resource Group</h2>

            <form className={styles.createForm} onSubmit={handleSubmit}>
                <div className={styles.inputContainer}>
                    <VSCodeDivider className={styles.fullWidth} />

                    <label htmlFor="rg-name-input" className={styles.label}>
                        Name
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

                    <label htmlFor="location-dropdown" className={styles.label}>
                        Location
                    </label>
                    <VSCodeDropdown
                        id="location-dropdown"
                        className={styles.longControl}
                        required
                        onBlur={handleLocationChange}
                        onChange={handleLocationChange}
                    >
                        <VSCodeOption value="">Select</VSCodeOption>
                        {props.locations.map((location) => (
                            <VSCodeOption key={location} value={location}>
                                {location}
                            </VSCodeOption>
                        ))}
                    </VSCodeDropdown>
                    {shouldShowMessage(location) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {location.message}
                        </span>
                    )}

                    <VSCodeDivider className={styles.fullWidth} />
                </div>

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit">Ok</VSCodeButton>
                    <VSCodeButton onClick={props.onCancel}>Cancel</VSCodeButton>
                </div>
            </form>
        </Dialog>
    );
}
