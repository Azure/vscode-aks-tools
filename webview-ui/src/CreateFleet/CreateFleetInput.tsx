import React, { FormEvent, useState } from "react";
import {
    CreateFleetParams,
    HubClusterMode,
    ResourceGroup,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { invalid, isValid, isValueSet, missing, unset, valid, Validatable } from "../utilities/validation";
import { MessageSink } from "../../../src/webview-contract/messaging";
import { EventDef } from "./helpers/state";
import { EventHandlers } from "../utilities/state";
import { just, Maybe, nothing } from "../utilities/maybe";

type ChangeEvent = Event | FormEvent<HTMLElement>;

interface CreateFleetInputProps {
    locations: string[];
    resourceGroups: ResourceGroup[];
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

export function CreateFleetInput(props: CreateFleetInputProps) {
    const [existingResourceGroup, setExistingResourceGroup] = useState<Validatable<ResourceGroup | null>>(unset());
    const [fleetName, setFleetName] = useState<Validatable<string>>(unset());
    // if show new resources group
    // new resource group name
    // hub cluster mode selection button
    const [selectedIndex, setSelectedIndex] = useState<number>(0); // resource group
    const [location, setLocation] = useState<Validatable<string>>(unset());

    const allResourcesGroups = props.resourceGroups;

    function handleValidationAndIndex(e: ChangeEvent) {
        handleExistingResourceGroupChange(e);
        const ele = e.currentTarget as HTMLSelectElement;
        setSelectedIndex(ele.selectedIndex);
    }

    function handleExistingResourceGroupChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLSelectElement;
        const resourceGroup = elem.selectedIndex <= 0 ? null : allResourcesGroups[elem.selectedIndex - 1];
        const validatable = resourceGroup ? valid(resourceGroup) : invalid(null, "Resource Group is required.");
        setExistingResourceGroup(validatable);
    }

    function handleFleetNameChange(e: ChangeEvent) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedName(name);
        setFleetName(validated);
    }

    function getValidatedName(name: string): Validatable<string> {
        if (!name) return invalid(name, "Fleet name must be at least 1 character long.");
        if (name.length > 63) return invalid(name, "Fleet name must be at most 63 characters long.");
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(name)) {
            return invalid(
                name,
                "The only allowed characters are letters, numbers, dashes, and underscore. The first and last character must be a letter or a number.",
            );
        }

        return valid(name);
    }

    function validate(): Maybe<CreateFleetParams> {
        if (!isValid(location)) return nothing();
        let resourceGroupName: string;
        let isNewResourceGroup: boolean;
        if (isValid(existingResourceGroup) && existingResourceGroup.value !== null) {
            resourceGroupName = existingResourceGroup.value.name;
            isNewResourceGroup = false;
            // } else if (newResourceGroupName) {
            //     resourceGroupName = newResourceGroupName;
            //     isNewResourceGroup = true;
        } else {
            return nothing();
        }
        if (!isValid(fleetName)) return nothing();

        const parameters: CreateFleetParams = {
            isNewResourceGroup,
            resourceGroupName,
            location: location.value,
            name: fleetName.value,
            hubClusterMode: HubClusterMode.Without, // hardcoded for now
        };

        return just(parameters);
    }

    function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        // Handle form submission logic here
        console.log("Resource Group:", existingResourceGroup);
        console.log("Location:", props.locations);
        validate();
        setLocation(missing<string>("somewhere"));
        // const parameters = validate();
        // props.eventHandlers.onSetCreating({ parameters: parameters.value }); // set state to creating
    }

    return (
        <>
            <form onSubmit={handleSubmit}>
                {/* <div>
                    <label htmlFor="fleetName">Fleet Name:</label>
                    <input
                        type="text"
                        id="fleetName"
                        value={fleetName}
                        onChange={(e) => setFleetName(e.currentTarget as HTMLInputElement).value}
                    />
                </div> */}

                <label>Testing Label:</label>
                <VSCodeTextField
                    id="name-input"
                    value={isValueSet(fleetName) ? fleetName.value : ""}
                    // className={}
                    onBlur={handleFleetNameChange}
                    onChange={handleFleetNameChange}
                />

                <div>
                    <label htmlFor="resourceGroup">Resource Group:</label>
                    <VSCodeDropdown
                        id="existing-resource-group-dropdown"
                        // className={styles.midControl}
                        onBlur={handleValidationAndIndex}
                        onChange={handleValidationAndIndex}
                        selectedIndex={selectedIndex}
                        aria-label="Select a resource group"
                    >
                        <VSCodeOption selected value="">
                            Select
                        </VSCodeOption>
                        {allResourcesGroups.length > 0 ? (
                            allResourcesGroups.map((group) => (
                                <VSCodeOption key={group.name} value={group.name}>
                                    {/* {group === newResourceGroup ? "(New)" : ""} {group.name} */}
                                    {""} {group.name}
                                </VSCodeOption>
                            ))
                        ) : (
                            <VSCodeOption disabled>No resource groups available</VSCodeOption>
                        )}
                    </VSCodeDropdown>
                </div>
                <button type="submit">Create</button>
            </form>
        </>
    );
}
