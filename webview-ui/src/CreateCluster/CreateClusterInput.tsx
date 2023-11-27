import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeLink,
    VSCodeOption,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import styles from "./CreateCluster.module.css";
import { FormEvent, useState } from "react";
import { Validatable, createHandler, shouldShowMessage, unset } from "../utilities/validation";
import { CreateResourceGroupDialog } from "./CreateResourceGroup";
import { EventHandlers } from "../utilities/state";
import {
    CreateClusterParams,
    ResourceGroup,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { MessageSink } from "../../../src/webview-contract/messaging";
import { EventDef } from "./helpers/state";
import { CreateClusterPresetInput } from "./CreateClusterPresetInput";

type ChangeEvent = Event | FormEvent<HTMLElement>;

interface CreateClusterInputProps {
    locations: string[];
    resourceGroups: ResourceGroup[];
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

export function CreateClusterInput(props: CreateClusterInputProps) {
    const [existingResourceGroup, setExistingResourceGroup] = useState<Validatable<ResourceGroup>>(unset());
    const [name, setName] = useState<Validatable<string>>(unset());
    const [isNewResourceGroupDialogShown, setIsNewResourceGroupDialogShown] = useState(false);
    const [newResourceGroup, setNewResourceGroup] = useState<ResourceGroup | null>(null);
    const [presetSelected, setPresetSelected] = useState("standard");

    function handleCreateResourceGroupDialogCancel() {
        setIsNewResourceGroupDialogShown(false);
    }

    function handleCreateResourceGroupDialogAccept(group: ResourceGroup) {
        setIsNewResourceGroupDialogShown(false);
        setExistingResourceGroup(unset());
        setNewResourceGroup(group);
    }

    function handlePresetSelection(presetSelected: string) {
        setPresetSelected(presetSelected);
    }

    const handleExistingResourceGroupChange = createHandler<ResourceGroup, ChangeEvent, HTMLSelectElement>(
        (e) => e.currentTarget as HTMLSelectElement,
        (elem) => (elem.selectedIndex <= 0 ? null : props.resourceGroups[elem.selectedIndex - 1]),
        (elem) => elem.checkValidity(),
        () => "Resource Group is required.",
        setExistingResourceGroup,
    );

    const handleNameChange = createHandler<string, ChangeEvent, HTMLInputElement>(
        (e) => e.currentTarget as HTMLInputElement,
        (elem) => elem.value || null,
        (elem) => elem.checkValidity(),
        (elem) =>
            elem.validity.patternMismatch
                ? "The only allowed characters are letters, numbers, dashes, and underscore. The first and last character must be a letter or a number."
                : elem.validity.tooShort
                  ? "Cluster name must be at least 1 character long."
                  : elem.validity.tooLong
                    ? "Cluster name must be at most 63 characters long."
                    : elem.validity.valueMissing
                      ? "Cluster name is required."
                      : "Invalid Cluster name.",
        setName,
    );

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const resourceGroup = (existingResourceGroup.value || newResourceGroup)!;
        const parameters: CreateClusterParams = {
            isNewResourceGroup: !existingResourceGroup.value,
            resourceGroup,
            location: resourceGroup.location,
            name: name.value!,
            preset: presetSelected
        };

        props.vscode.postCreateClusterRequest(parameters);
        props.eventHandlers.onSetCreating({ parameters });
    }

    return (
        <>
            <form className={styles.createForm} onSubmit={handleSubmit}>
                <div className={styles.inputContainer}>
                    <CreateClusterPresetInput onPresetSelected={handlePresetSelection}></CreateClusterPresetInput>
                    <VSCodeDivider className={styles.fullWidth} />

                    <label htmlFor="existing-resource-group-dropdown" className={styles.label}>
                        Resource Group
                    </label>
                    <VSCodeDropdown
                        id="existing-resource-group-dropdown"
                        className={styles.midControl}
                        disabled={newResourceGroup !== null}
                        required={newResourceGroup === null}
                        onBlur={handleExistingResourceGroupChange}
                        onChange={handleExistingResourceGroupChange}
                        selectedIndex={
                            existingResourceGroup.value
                                ? props.resourceGroups.indexOf(existingResourceGroup.value) + 1
                                : 0
                        }
                    >
                        <VSCodeOption value="">Select</VSCodeOption>
                        {props.resourceGroups.map((group) => (
                            <VSCodeOption key={group.name} value={group.name}>
                                {group.name} ({group.location})
                            </VSCodeOption>
                        ))}
                    </VSCodeDropdown>

                    <VSCodeButton
                        className={styles.sideControl}
                        onClick={() => setIsNewResourceGroupDialogShown(true)}
                        disabled={newResourceGroup !== null}
                    >
                        Create New...
                    </VSCodeButton>
                    {shouldShowMessage(existingResourceGroup) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {existingResourceGroup.message}
                        </span>
                    )}

                    {newResourceGroup && (
                        <>
                            <VSCodeTextField
                                readOnly
                                className={styles.midControl}
                                value={`${newResourceGroup.name} (${newResourceGroup.location})`}
                            ></VSCodeTextField>
                            <VSCodeButton className={styles.sideControl} onClick={() => setNewResourceGroup(null)}>
                                Clear
                            </VSCodeButton>
                        </>
                    )}

                    <label htmlFor="name-input" className={styles.label}>
                        Name
                    </label>
                    <VSCodeTextField
                        id="name-input"
                        value={name.value || ""}
                        className={`${styles.longControl} ${styles.validatable}`}
                        required
                        minlength={1}
                        maxlength={63}
                        pattern="^[a-zA-Z0-9][a-zA-Z0-9_\-]+[a-zA-Z0-9]$"
                        onBlur={handleNameChange}
                        onInput={handleNameChange}
                    />
                    {shouldShowMessage(name) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {name.message}
                        </span>
                    )}
                    <VSCodeDivider className={styles.fullWidth} />
                </div>

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit">Create</VSCodeButton>
                </div>
            </form>

            <CreateResourceGroupDialog
                isShown={isNewResourceGroupDialogShown}
                locations={props.locations}
                onCancel={handleCreateResourceGroupDialogCancel}
                onAccept={handleCreateResourceGroupDialogAccept}
            />
        </>
    );
}
