import { VSCodeButton, VSCodeDivider, VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle, faTimesCircle } from '@fortawesome/free-solid-svg-icons';
import styles from "./CreateCluster.module.css";
import { FormEvent, useState } from "react";
import { Validatable, createHandler, shouldShowMessage, unset } from "../utilities/validation";
import { CreateResourceGroupDialog } from "./CreateResourceGroup";
import { EventHandlers } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";
import { CreateClusterParams, ResourceGroup, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { MessageSink } from "../../../src/webview-contract/messaging";

type ChangeEvent = Event | FormEvent<HTMLElement>;

interface CreateClusterInputProps {
    locations: string[]
    resourceGroups: ResourceGroup[]
    userMessageHandlers: EventHandlers<UserMsgDef>
    vscode: MessageSink<ToVsCodeMsgDef>
}

export function CreateClusterInput(props: CreateClusterInputProps) {
    const [existingResourceGroup, setExistingResourceGroup] = useState<Validatable<ResourceGroup>>(unset());
    const [name, setName] = useState<Validatable<string>>(unset());
    const [isNewResourceGroupDialogShown, setIsNewResourceGroupDialogShown] = useState(false);
    const [newResourceGroup, setNewResourceGroup] = useState<ResourceGroup | null>(null);

    function handleCreateResourceGroupDialogCancel() {
        setIsNewResourceGroupDialogShown(false);
    }

    function handleCreateResourceGroupDialogAccept(group: ResourceGroup) {
        setIsNewResourceGroupDialogShown(false);
        setExistingResourceGroup(unset());
        setNewResourceGroup(group);
    }

    const handleExistingResourceGroupChange = createHandler<ResourceGroup, ChangeEvent, HTMLSelectElement>(
        e => e.currentTarget as HTMLSelectElement,
        elem => elem.selectedIndex <= 0 ? null : props.resourceGroups[elem.selectedIndex - 1], 
        elem => elem.checkValidity(),
        _ => "Resource Group is required.",
        setExistingResourceGroup);

    const handleNameChange = createHandler<string, ChangeEvent, HTMLInputElement>(
        e => e.currentTarget as HTMLInputElement,
        elem => elem.value || null,
        elem => elem.checkValidity(),
        elem => elem.validity.patternMismatch ? "Cluster name must consist only of letters, numbers, dashes and underscores."
            : elem.validity.tooShort ? "Cluster name must be at least 1 character long."
            : elem.validity.tooLong ? "Cluster name must be at most 63 characters long."
            : elem.validity.valueMissing ? "Cluster name is required."
            : "Invalid Cluster name.",
        setName);

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const resourceGroup = (existingResourceGroup.value || newResourceGroup)!;
        const parameters: CreateClusterParams = {
            isNewResourceGroup: !existingResourceGroup.value,
            resourceGroup,
            location: resourceGroup.location,
            name: name.value!
        };

        props.vscode.postMessage({ command: "createClusterRequest", parameters });
        props.userMessageHandlers.onSetCreating({parameters});
    }

    return (
    <>
        <form className={styles.createForm} onSubmit={handleSubmit}>
            <div className={styles.inputContainer}>
                <span className={styles.fullWidth}>
                    <FontAwesomeIcon icon={faInfoCircle} className={styles.infoIndicator} />
                    This will create a <i>Standard</i> cluster. See
                    &nbsp;<VSCodeLink href="https://learn.microsoft.com/en-us/azure/aks/quotas-skus-regions#cluster-configuration-presets-in-the-azure-portal">Presets</VSCodeLink>&nbsp;
                    for more information.
                </span>
                <VSCodeDivider className={styles.fullWidth}/>

                <label htmlFor="existing-resource-group-dropdown" className={styles.label}>Resource Group</label>
                <VSCodeDropdown
                    id="existing-resource-group-dropdown"
                    className={styles.midControl}
                    disabled={newResourceGroup !== null}
                    required={newResourceGroup === null}
                    onBlur={handleExistingResourceGroupChange}
                    onChange={handleExistingResourceGroupChange}
                    selectedIndex={existingResourceGroup.value ? props.resourceGroups.indexOf(existingResourceGroup.value) + 1 : 0}
                >
                    <VSCodeOption value="">Select</VSCodeOption>
                    {props.resourceGroups.map(group => (
                        <VSCodeOption key={group.name} value={group.name}>{group.name} ({group.location})</VSCodeOption>
                    ))}
                </VSCodeDropdown>

                <VSCodeButton
                    className={styles.sideControl}
                    onClick={() => setIsNewResourceGroupDialogShown(true)}
                    disabled={newResourceGroup !== null}
                >
                    Create New...
                </VSCodeButton>
                {
                    shouldShowMessage(existingResourceGroup) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {existingResourceGroup.message}
                    </span>
                    )
                }

                {newResourceGroup && (
                    <>
                        <VSCodeTextField readOnly className={styles.midControl} value={`${newResourceGroup.name} (${newResourceGroup.location})`}></VSCodeTextField>
                        <VSCodeButton className={styles.sideControl} onClick={() => setNewResourceGroup(null)}>Clear</VSCodeButton>
                    </>
                )}

                <label htmlFor="name-input" className={styles.label}>Name</label>
                <VSCodeTextField
                    id="name-input"
                    value={name.value || ''}
                    className={`${styles.longControl} ${styles.validatable}`}
                    required
                    minlength={1}
                    maxlength={63}
                    pattern="[a-zA-Z0-9_\-]+"
                    onBlur={handleNameChange}
                    onInput={handleNameChange}
                />
                {
                    shouldShowMessage(name) && (
                    <span className={styles.validationMessage}>
                        <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                        {name.message}
                    </span>
                    )
                }
                <VSCodeDivider className={styles.fullWidth}/>
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
    )
}