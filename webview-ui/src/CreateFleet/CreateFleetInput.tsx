import { FormEvent, useState } from "react";
import {
    CreateFleetParams,
    HubMode,
    ResourceGroup,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import {
    hasMessage,
    invalid,
    isValid,
    isValueSet,
    toNullable,
    missing,
    unset,
    valid,
    Validatable,
} from "../utilities/validation";
import { MessageSink } from "../../../src/webview-contract/messaging";
import { EventDef } from "./helpers/state";
import { EventHandlers } from "../utilities/state";
import { isNothing, just, Maybe, nothing } from "../utilities/maybe";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import styles from "./CreateFleet.module.css";
import { CreateFleetModeInput } from "./CreateFleetModeInput";

type ChangeEvent = Event | FormEvent<HTMLElement>;

interface CreateFleetInputProps {
    locations: string[];
    resourceGroups: ResourceGroup[];
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
    subscriptionId: string;
}

export function CreateFleetInput(props: CreateFleetInputProps) {
    const [existingResourceGroup, setExistingResourceGroup] = useState<Validatable<ResourceGroup | null>>(unset());
    const [fleetName, setFleetName] = useState<Validatable<string>>(unset());
    const [selectedResourceGroupIndex, setselectedResourceGroupIndex] = useState<number>(0);
    const [location, setLocation] = useState<Validatable<string>>(unset());
    const [hubModeSelected, setHubModeSelected] = useState<HubMode>(HubMode.With);
    const [dnsPrefix, setDnsPrefix] = useState<Validatable<string>>(unset());

    const allResourcesGroups = props.resourceGroups; // All available resource groups fetched from the portal

    function handleValidationAndIndex(e: ChangeEvent) {
        handleExistingResourceGroupChange(e);
        const ele = e.currentTarget as HTMLSelectElement;
        setselectedResourceGroupIndex(ele.selectedIndex);
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
        // Fleet name validation rules from the Azure REST API specs
        // https://github.com/Azure/azure-rest-api-specs/blob/24d856b33d49b5ac6227a51c610b7d8b0f289458/specification/containerservice/resource-manager/Microsoft.ContainerService/fleet/stable/2024-04-01/fleets.json#L193C10-L202C12
        if (!name) return invalid(name, "Fleet name must be at least 1 character long.");
        if (name.length > 63) return invalid(name, "Fleet name must be at most 63 characters long.");
        if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
            return invalid(
                name,
                "The only allowed characters are lowercase alphanumeric characters and '-'. The first and last character must be an alphanumeric character.",
            );
        }

        return valid(name);
    }

    function handleLocationChange(e: ChangeEvent) {
        const elem = e.currentTarget as HTMLSelectElement;
        const location = elem.selectedIndex <= 0 ? null : props.locations[elem.selectedIndex - 1];
        const validated = location ? valid(location) : missing<string>("Location is required.");
        setLocation(validated);
    }

    function validate(): Maybe<CreateFleetParams> {
        if (!isValid(location)) return nothing();
        let resourceGroupName: string;
        if (isValid(existingResourceGroup) && existingResourceGroup.value !== null) {
            resourceGroupName = existingResourceGroup.value.name;
        } else {
            return nothing();
        }
        if (!isValid(fleetName)) return nothing();
        if (hubModeSelected === HubMode.With && !isValid(dnsPrefix)) return nothing();

        const parameters: CreateFleetParams = {
            resourceGroupName,
            location: location.value,
            name: fleetName.value,
            hubMode: hubModeSelected,
            dnsPrefix: toNullable(dnsPrefix),
        };

        return just(parameters);
    }

    function handleHubModeChange(hubModeSelected: HubMode) {
        setHubModeSelected(hubModeSelected);
    }

    function handleDnsPrefixChange(dnsPrefix: Validatable<string>) {
        setDnsPrefix(dnsPrefix);
    }

    function handleSubmit(event: FormEvent) {
        event.preventDefault();
        const parameters = validate();
        if (isNothing(parameters)) return;
        props.vscode.postCreateFleetRequest(parameters.value);
        props.eventHandlers.onSetCreating({ parameters: parameters.value }); // Set to Stage.Creating
    }

    return (
        <form className={styles.createForm} onSubmit={handleSubmit}>
            <div className={styles.inputContainer}>
                <label htmlFor="fleet-details" className={`${styles.fleetDetailsLabel}`}>
                    Fleet details
                </label>

                <label className={styles.label}>Fleet Name*</label>
                <VSCodeTextField
                    id="name-input"
                    value={isValueSet(fleetName) ? fleetName.value : ""}
                    className={`${styles.longControl} ${styles.validatable}`}
                    onBlur={handleFleetNameChange}
                    onChange={handleFleetNameChange}
                />
                {hasMessage(fleetName) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {fleetName.message}
                    </span>
                )}

                <label htmlFor="resourceGroup" className={styles.label}>
                    Resource Group*
                </label>
                <VSCodeDropdown
                    id="existing-resource-group-dropdown"
                    className={styles.longControl}
                    onBlur={handleValidationAndIndex}
                    onChange={handleValidationAndIndex}
                    selectedIndex={selectedResourceGroupIndex}
                    aria-label="Select a resource group"
                >
                    <VSCodeOption selected value="">
                        Select
                    </VSCodeOption>
                    {allResourcesGroups.length > 0 ? (
                        allResourcesGroups.map((group) => (
                            <VSCodeOption key={group.name} value={group.name}>
                                {""} {group.name}
                            </VSCodeOption>
                        ))
                    ) : (
                        <VSCodeOption disabled>No resource groups available</VSCodeOption>
                    )}
                </VSCodeDropdown>
                {hasMessage(existingResourceGroup) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {existingResourceGroup.message}
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

            <CreateFleetModeInput
                hubMode={hubModeSelected}
                dnsPrefix={dnsPrefix}
                onModeSelected={handleHubModeChange}
                onDnsPrefixChange={handleDnsPrefixChange}
            ></CreateFleetModeInput>

            <div className={styles.buttonContainer}>
                <VSCodeButton type="submit">Create</VSCodeButton>
            </div>
        </form>
    );
}
