//import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/automatedDeployments";
//import { faFolder } from "@fortawesome/free-regular-svg-icons";

import {
    //AutomatedDeploymentsState,
    stateUpdater,
    vscode,
} from "./state";

import { useStateManagement } from "../utilities/state";
import { FormEvent, useEffect } from "react";
import styles from "./AutomatedDeployments.module.css";
import { NewOrExisting, Subscription } from "../../../src/webview-contract/webviewDefinitions/draft/types";
import {
    Validatable,
    hasMessage,
    isValid,
    //     invalid,
    //     isValueSet,
    missing,
    orDefault,
    toNullable,
    //     unset,
    valid,
} from "../utilities/validation";
import { ResourceSelector } from "../components/ResourceSelector";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    //faFolder,
    // faPlus,
    faTimesCircle,
    //faTrash
} from "@fortawesome/free-solid-svg-icons";
import {} from //Lazy,
//, map as lazyMap
"../utilities/lazy";
import {} from //distinct,
//, filterNulls
//, replaceItem
"../utilities/array";
import { CreateResourceGroupDialog } from "../CreateCluster/CreateResourceGroup";
import { TextWithDropdown } from "../components/TextWithDropdown";
//import { isSet } from "util/types";

export function AutomatedDeployments(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    //Request the list of repositories from the backend once when the component is mounted.
    useEffect(() => {
        vscode.postGetGitHubReposRequest();
        vscode.postGetResourceGroupsRequest();
        vscode.postGetSubscriptionsRequest();
    }, []);

    // function handleGitHubRepoSelect(repo: string | null) {
    //     const validated = repo === null ? missing<string>("GitHub repository is required.") : valid(repo);
    //     eventHandlers.onSetSelectedGitHubRepo(validated);
    // }

    function handleFormSubmit(e: FormEvent) {
        //Do nothing for now
        e.bubbles = false;
    }

    function handleWorkflowNameChange(e: Event | FormEvent<HTMLElement>) {
        //TODO: Requires 2 Layers check, 1) check if local env contains the same workflow 2) check if workflow app name exists in remote
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedWorkflowName(name);
        eventHandlers.onSetSelectedWorkflowName(validated);

        function getValidatedWorkflowName(name: string): Validatable<string> {
            //if (!name) return missing("Workflow name is required.");

            // TODO: valid filename checking
            //if (state.existingWorkflowFiles.some((f) => f.name === name)) {
            //    return invalid(name, "Workflow with this name already exists.");
            // }

            return valid(name);
        }
    }

    function handleGitHubRepoSelect(repo: string | null) {
        //TODO: Proper validation, and type
        //const validated = repo === null ? missing<GitHubRepo>("GitHub repository is required.") : valid(repo);
        //eventHandlers.onSetSelectedGitHubRepo(validated);

        console.log("Selected GitHub Repo:", repo);
    }

    function handleSubscriptionSelect(subscription: Subscription | null) {
        const validated =
            subscription === null ? missing<Subscription>("Subscription is required.") : valid(subscription);
        eventHandlers.onSetSelectedSubscription(validated);
    }

    function handleCreateWorkflowClick() {
        vscode.postCreateWorkflowRequest();
    }

    function handleCreateResourceGroupDialogCancel() {
        eventHandlers.onSetIsNewResourceGroupDialogShown(false);
    }

    function handleCreateResourceGroupDialogAccept(groupName: string) {
        //Need logic to identify if resource group should be created later on
        eventHandlers.onSetIsNewResourceGroupDialogShown(false);
        //eventHandlers.onSetExistingResourceGroup(valid(null));
        eventHandlers.onSetNewResourceGroupName(valid(groupName));
        //eventHandlers.onSetSelectedIndex(1); // this is the index of the new resource group and the first option is "Select"
        console.log("New Resource Group Name:", groupName);
    }

    function handleNamespaceSelect(namespace: string | null, isNew: boolean) {
        const validated = getValidatedNamespace();
        eventHandlers.onSetSelectedNamespace(validated);
        console.log("Selected Namespace:", namespace, " isNew:", isNew);

        function getValidatedNamespace(): Validatable<NewOrExisting<string>> {
            if (!namespace) return missing("Namespace is required.");
            return valid({ isNew, value: namespace });
        }
    }

    const gitHubRepoTooltipMessage =
        "Select the primary/upstream fork of this repository.\n\nThis will allow you to select which branch will trigger the workflow.";

    const namespaceTooltipMessage =
        "To create a new namespace, write the desired name in the field. If the namespace does not already exist, it will be be created upon workflow submission.";

    return (
        <>
            <form className={styles.wrapper} onSubmit={handleFormSubmit}>
                <h2>Launch Automated Deployments Using DevHub</h2>

                <h3 className={styles.fullWidth}>Workflow properties</h3>
                <fieldset className={styles.inputContainer} disabled={state.status !== "Editing"}>
                    <label htmlFor="workflow-name-input" className={styles.label}>
                        Workflow name *
                    </label>

                    <input
                        type="text"
                        id="workflow-name-input"
                        value={orDefault(state.selectedWorkflowName, "")}
                        className={styles.control}
                        onBlur={handleWorkflowNameChange}
                        onInput={handleWorkflowNameChange}
                    />
                    {hasMessage(state.selectedWorkflowName) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedWorkflowName.message}
                        </span>
                    )}

                    <label htmlFor="gh-repo-input" className={styles.label}>
                        GitHub repository *
                        <span className={"tooltip-holder"} data-tooltip-text={gitHubRepoTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>
                    <ResourceSelector<string>
                        id="gh-repo-input"
                        className={styles.control}
                        resources={state.githubRepos}
                        selectedItem={toNullable(state.selectedGitHubRepo)}
                        valueGetter={(r) => r}
                        labelGetter={(r) => r}
                        onSelect={handleGitHubRepoSelect}
                    />

                    <label htmlFor="subscription-input" className={styles.label}>
                        Subscription *
                    </label>
                    <ResourceSelector<Subscription>
                        id="subscription-input"
                        className={styles.control}
                        resources={isValid(state.subscriptions) ? state.subscriptions.value : []}
                        selectedItem={toNullable(state.selectedSubscription)}
                        valueGetter={(l) => l.id}
                        labelGetter={(l) => l.name}
                        onSelect={handleSubscriptionSelect}
                    />
                    {hasMessage(state.selectedSubscription) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedSubscription.message}
                        </span>
                    )}

                    <label htmlFor="existing-resource-group-dropdown" className={styles.label}>
                        Resource Group*
                    </label>
                    <ResourceSelector<string>
                        id="existing-resource-group-dropdown"
                        className={styles.midControl}
                        resources={
                            isValid(state.resourceGroups)
                                ? state.resourceGroups.value.map((g) => g.name)
                                : ["Loading..."]
                        }
                        selectedItem={toNullable(state.selectedAcrResourceGroup)}
                        valueGetter={(g) => g}
                        labelGetter={(g) => g}
                        onSelect={(g) => console.log("Selected Resource Group:", g)}
                    />

                    <button
                        className={styles.sideControl}
                        onClick={() => eventHandlers.onSetIsNewResourceGroupDialogShown(true)}
                    >
                        Create New Resource Group
                    </button>

                    {state.isNewResourceGroupDialogShown && (
                        <CreateResourceGroupDialog
                            isShown={state.isNewResourceGroupDialogShown}
                            locations={["America", "Other Test"]}
                            onCancel={handleCreateResourceGroupDialogCancel}
                            onAccept={handleCreateResourceGroupDialogAccept}
                        />
                    )}

                    <label htmlFor="namespace-input" className={styles.label}>
                        Namespace *
                        <span className={"tooltip-holder"} data-tooltip-text={namespaceTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>

                    <TextWithDropdown
                        id="namespace-input"
                        className={styles.control}
                        getAddItemText={(text) => `Use "${text}"`}
                        items={["default_test", "test", "dev"]} //Proper namespace selection requires resource group selection first
                        selectedItem={toNullable(state.selectedDeploymentNamespace)?.value || null}
                        onSelect={handleNamespaceSelect}
                    />
                </fieldset>
            </form>

            <div className={styles.buttonContainer}>
                <button type="submit" onClick={handleCreateWorkflowClick}>
                    Create DevHub Workflow
                </button>
            </div>
        </>
    );
}
