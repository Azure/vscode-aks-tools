import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FormEvent, useState } from "react";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    CreateClusterParams,
    Preset,
    ResourceGroup,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { EventHandlers } from "../utilities/state";
import { Validatable, createHandler, shouldShowMessage, unset } from "../utilities/validation";
import styles from "./CreateCluster.module.css";
import { CreateClusterPresetInput } from "./CreateClusterPresetInput";
import { CreateResourceGroupDialog } from "./CreateResourceGroup";
import { EventDef } from "./helpers/state";

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
    const [newResourceGroupName, setNewResourceGroupName] = useState<string | null>(null);
    const [presetSelected, setPresetSelected] = useState<Preset>("dev");
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [location, setLocation] = useState<Validatable<string>>(unset());

    const newResourceGroup = newResourceGroupName
        ? {
              name: newResourceGroupName,
              location: location.value || "",
          }
        : null;
    const allResourceGroups = newResourceGroup ? [newResourceGroup, ...props.resourceGroups] : props.resourceGroups;

    function handleCreateResourceGroupDialogCancel() {
        setIsNewResourceGroupDialogShown(false);
    }

    function handleCreateResourceGroupDialogAccept(groupName: string) {
        setIsNewResourceGroupDialogShown(false);
        setExistingResourceGroup(unset());
        setNewResourceGroupName(groupName);
        setSelectedIndex(1); // this is the index of the new resource group and the first option is "Select"
    }

    function handlePresetSelection(presetSelected: Preset) {
        setPresetSelected(presetSelected);
    }

    function handleValidationAndIndex(e: ChangeEvent) {
        handleExistingResourceGroupChange(e);
        const ele = e.currentTarget as HTMLSelectElement;
        setSelectedIndex(ele.selectedIndex);
    }

    const handleExistingResourceGroupChange = createHandler<ResourceGroup, ChangeEvent, HTMLSelectElement>(
        (e) => e.currentTarget as HTMLSelectElement,
        (elem) => (elem.selectedIndex < 0 ? null : allResourceGroups[elem.selectedIndex - 1]),
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

    const handleLocationChange = createHandler<string, ChangeEvent, HTMLSelectElement>(
        (e) => e.currentTarget as HTMLSelectElement,
        (elem) => (elem.selectedIndex <= 0 ? null : props.locations[elem.selectedIndex - 1]),
        (elem) => elem.checkValidity(),
        () => "Location is required.",
        setLocation,
    );

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const resourceGroup = existingResourceGroup.value || newResourceGroup;
        if (!resourceGroup) return;
        if (!location.value) return;

        const parameters: CreateClusterParams = {
            isNewResourceGroup: !existingResourceGroup.value,
            resourceGroupName: resourceGroup.name,
            location: location.value!,
            name: name.value!,
            preset: presetSelected,
        };

        props.vscode.postCreateClusterRequest(parameters);
        props.eventHandlers.onSetCreating({ parameters });
    }

    return (
        <>
            <form className={styles.createForm} onSubmit={handleSubmit}>
                <div className={styles.inputContainer}>
                    <CreateClusterPresetInput onPresetSelected={handlePresetSelection}></CreateClusterPresetInput>
                    <label htmlFor="cluster-details" className={styles.clusterDetailsLabel}>
                        Cluster details
                    </label>
                    <label htmlFor="existing-resource-group-dropdown" className={styles.label}>
                        Resource Group*
                    </label>
                    <VSCodeDropdown
                        id="existing-resource-group-dropdown"
                        className={styles.midControl}
                        required
                        onBlur={handleValidationAndIndex}
                        onChange={handleValidationAndIndex}
                        selectedIndex={selectedIndex}
                        aria-label="Select a resource group"
                    >
                        <VSCodeOption selected value="">
                            Select
                        </VSCodeOption>
                        {allResourceGroups.length > 0 ? (
                            allResourceGroups.map((group) => (
                                <VSCodeOption key={group.name} value={group.name}>
                                    {group === newResourceGroup ? "(New)" : ""} {group.name}
                                </VSCodeOption>
                            ))
                        ) : (
                            <VSCodeOption disabled>No resource groups available</VSCodeOption>
                        )}
                    </VSCodeDropdown>

                    <VSCodeButton className={styles.sideControl} onClick={() => setIsNewResourceGroupDialogShown(true)}>
                        Create New
                    </VSCodeButton>
                    {shouldShowMessage(existingResourceGroup) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {existingResourceGroup.message}
                        </span>
                    )}

                    <label htmlFor="name-input" className={styles.label}>
                        Cluster Name*
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

                    <label htmlFor="location-dropdown" className={styles.label}>
                        Location*
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
                </div>

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit">Create</VSCodeButton>
                </div>
            </form>

            {isNewResourceGroupDialogShown && (
                <CreateResourceGroupDialog
                    isShown={isNewResourceGroupDialogShown}
                    locations={props.locations}
                    onCancel={handleCreateResourceGroupDialogCancel}
                    onAccept={handleCreateResourceGroupDialogAccept}
                />
            )}
        </>
    );
}
