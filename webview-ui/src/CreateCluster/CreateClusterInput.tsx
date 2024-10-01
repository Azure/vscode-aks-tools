import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FormEvent, useState } from "react";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    CreateClusterParams,
    PresetType,
    ResourceGroup,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { Maybe, isNothing, just, nothing } from "../utilities/maybe";
import { EventHandlers } from "../utilities/state";
import { Validatable, hasMessage, invalid, isValid, isValueSet, missing, unset, valid } from "../utilities/validation";
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
    const [existingResourceGroup, setExistingResourceGroup] = useState<Validatable<ResourceGroup | null>>(unset());
    const [name, setName] = useState<Validatable<string>>(unset());
    const [isNewResourceGroupDialogShown, setIsNewResourceGroupDialogShown] = useState(false);
    const [newResourceGroupName, setNewResourceGroupName] = useState<string | null>(null);
    const [presetSelected, setPresetSelected] = useState<PresetType>(PresetType.Automatic);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [location, setLocation] = useState<Validatable<string>>(unset());

    const newResourceGroup = newResourceGroupName
        ? {
              name: newResourceGroupName,
              location: isValid(location) ? location.value : "",
          }
        : null;
    const allResourceGroups = newResourceGroup ? [newResourceGroup, ...props.resourceGroups] : props.resourceGroups;

    function handleCreateResourceGroupDialogCancel() {
        setIsNewResourceGroupDialogShown(false);
    }

    function handleCreateResourceGroupDialogAccept(groupName: string) {
        setIsNewResourceGroupDialogShown(false);
        setExistingResourceGroup(valid(null));
        setNewResourceGroupName(groupName);
        setSelectedIndex(1); // this is the index of the new resource group and the first option is "Select"
    }

    function handlePresetSelection(presetSelected: PresetType) {
        setPresetSelected(presetSelected);
    }

    function handleValidationAndIndex(e: ChangeEvent) {
        handleExistingResourceGroupChange(e);
        const ele = e.currentTarget as HTMLSelectElement;
        setSelectedIndex(ele.selectedIndex);
    }

    function handleExistingResourceGroupChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLSelectElement;
        const resourceGroup = elem.selectedIndex <= 0 ? null : allResourceGroups[elem.selectedIndex - 1];
        const validatable = resourceGroup ? valid(resourceGroup) : invalid(null, "Resource Group is required.");
        setExistingResourceGroup(validatable);
    }

    function getValidatedName(name: string): Validatable<string> {
        if (!name) return invalid(name, "Cluster name must be at least 1 character long.");
        if (name.length > 63) return invalid(name, "Cluster name must be at most 63 characters long.");
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(name)) {
            return invalid(
                name,
                "The only allowed characters are letters, numbers, dashes, and underscore. The first and last character must be a letter or a number.",
            );
        }

        return valid(name);
    }

    function handleNameChange(e: ChangeEvent) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedName(name);
        setName(validated);
    }

    function handleLocationChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLSelectElement;
        const location = elem.selectedIndex <= 0 ? null : props.locations[elem.selectedIndex - 1];
        const validated = location ? valid(location) : missing<string>("Location is required.");
        setLocation(validated);
    }

    function validate(): Maybe<CreateClusterParams> {
        if (!isValid(location)) return nothing();
        let resourceGroupName: string;
        let isNewResourceGroup: boolean;
        if (isValid(existingResourceGroup) && existingResourceGroup.value !== null) {
            resourceGroupName = existingResourceGroup.value.name;
            isNewResourceGroup = false;
        } else if (newResourceGroupName) {
            resourceGroupName = newResourceGroupName;
            isNewResourceGroup = true;
        } else {
            return nothing();
        }
        if (!isValid(name)) return nothing();

        const parameters: CreateClusterParams = {
            isNewResourceGroup,
            resourceGroupName,
            location: location.value,
            name: name.value,
            preset: presetSelected,
        };

        return just(parameters);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const parameters = validate();
        if (isNothing(parameters)) return;
        props.vscode.postCreateClusterRequest(parameters.value);
        props.eventHandlers.onSetCreating({ parameters: parameters.value });
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
                    {hasMessage(existingResourceGroup) && (
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

                    <label htmlFor="location-dropdown" className={styles.label}>
                        Region*
                    </label>
                    <VSCodeDropdown
                        id="location-dropdown"
                        className={styles.longControl}
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
                    {hasMessage(location) && (
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
