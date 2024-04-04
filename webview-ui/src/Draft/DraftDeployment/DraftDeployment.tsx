import { FormEvent, useEffect } from "react";
import { CreateParams, InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDeployment";
import {
    DeploymentSpecType,
    NewOrExisting,
    Subscription,
    VsCodeCommand,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import styles from "../Draft.module.css";
import { useStateManagement } from "../../utilities/state";
import { DraftDeploymentState, getExistingPaths, stateUpdater, vscode } from "./state";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import {
    Validatable,
    fromNullable,
    hasMessage,
    invalid,
    isValid,
    missing,
    orDefault,
    toNullable,
    valid,
} from "../../utilities/validation";
import {
    EventHandlerFunc,
    ensureAcrImageTagsLoaded,
    ensureAcrsLoaded,
    ensureAcrRepositoryNamesLoaded,
    ensureClustersLoaded,
    ensureClusterNamespacesLoaded,
    ensureSubscriptionsLoaded,
} from "./dataLoading";
import { Lazy, isLoaded, map as lazyMap } from "../../utilities/lazy";
import { ResourceSelector } from "../../components/ResourceSelector";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import {
    VSCodeButton,
    VSCodeLink,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { faFolder } from "@fortawesome/free-regular-svg-icons";
import { NewImageTagDialog } from "../dialogs/NewImageTagDialog";
import { NewNamespaceDialog } from "../dialogs/NewNamespaceDialog";
import { NewRepositoryDialog } from "../dialogs/NewRepositoryDialog";
import { distinct } from "../../utilities/array";

export function DraftDeployment(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    const updates: EventHandlerFunc[] = [];
    const {
        lazySubscriptions,
        lazyClusterResourceGroups,
        lazyClusterNames,
        lazyClusterNamespaces,
        lazyAcrResourceGroups,
        lazyAcrNames,
        lazyRepositoryNames,
        lazyImageTags,
    } = prepareData(state, updates);
    useEffect(() => {
        updates.map((fn) => fn(eventHandlers));
    });

    function handleSubscriptionSelect(subscription: Subscription | null) {
        const validated =
            subscription === null ? missing<Subscription>("Subscription is required.") : valid(subscription);
        eventHandlers.onSetSubscription(validated);
    }

    function handleAcrResourceGroupSelect(resourceGroup: string | null) {
        const validated =
            resourceGroup === null ? missing<string>("ACR resource group is required.") : valid(resourceGroup);
        eventHandlers.onSetAcrResourceGroup(validated);
    }

    function handleAcrSelect(acr: string | null) {
        const validated = acr === null ? missing<string>("ACR is required.") : valid(acr);
        eventHandlers.onSetAcr(validated);
    }

    function handleRepositorySelect(repository: NewOrExisting<string> | null) {
        const validated =
            repository === null ? missing<NewOrExisting<string>>("Repository is required.") : valid(repository);
        eventHandlers.onSetAcrRepository(validated);
    }

    function handleNewRepositoryClick() {
        eventHandlers.onSetDialogContent({
            dialog: "newRepository",
            content: {
                repository: fromNullable(state.newAcrRepository),
            },
        });
        eventHandlers.onSetDialogVisibility({
            dialog: "newRepository",
            shown: true,
        });
    }

    function handleImageTagSelect(imageTag: NewOrExisting<string> | null) {
        const validated =
            imageTag === null ? missing<NewOrExisting<string>>("Image tag is required.") : valid(imageTag);
        eventHandlers.onSetAcrRepoTag(validated);
    }

    function handleImageTagChangeForNewRepository(e: Event | FormEvent<HTMLElement>) {
        const value = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedImageTagForNewRepository(value);
        eventHandlers.onSetAcrRepoTag(validated);

        function getValidatedImageTagForNewRepository(tag: string): Validatable<NewOrExisting<string>> {
            if (!tag) return missing("Image tag name is required.");
            return valid({
                isNew: true,
                value: tag,
            });
        }
    }

    function handleNewImageTagClick() {
        eventHandlers.onSetDialogContent({
            dialog: "newImageTag",
            content: {
                imageTag: fromNullable(state.newAcrRepoTag),
            },
        });
        eventHandlers.onSetDialogVisibility({
            dialog: "newImageTag",
            shown: true,
        });
    }

    function handleChooseLocationClick() {
        vscode.postPickLocationRequest({
            defaultPath: state.workspaceConfig.fullPath,
            type: "directory",
            title: "Location to save deployment files",
            buttonLabel: "Select",
        });
    }

    function handleDeploymentSpecTypeChange(e: Event | FormEvent<HTMLElement>) {
        const type = (e.currentTarget as HTMLInputElement).value as DeploymentSpecType;
        eventHandlers.onSetDeploymentSpecType(type);
    }

    function handleApplicationNameChange(e: Event | FormEvent<HTMLElement>) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedApplicationName(name);
        eventHandlers.onSetApplicationName(validated);

        function getValidatedApplicationName(name: string): Validatable<string> {
            if (!name) return missing("Application name is required.");

            // TODO: further validation
            return valid(name);
        }
    }

    function handlePortChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.currentTarget as HTMLInputElement;
        const port = parseInt(elem.value);
        const validated = getValidatedPort(port);
        eventHandlers.onSetPort(validated);

        function getValidatedPort(port: number): Validatable<number> {
            if (Number.isNaN(port)) {
                return invalid(port, "Port must be a number.");
            }
            if (port < 1 || port > 65535) {
                return invalid(port, "Port number must be between 1 and 65535.");
            }

            return valid(port);
        }
    }

    function handleNamespaceChange(e: Event | FormEvent<HTMLElement>) {
        const namespace = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedNamespace(namespace);
        eventHandlers.onSetNewClusterNamespace(namespace);
        eventHandlers.onSetClusterNamespace(validated);

        function getValidatedNamespace(namespace: string): Validatable<NewOrExisting<string>> {
            if (!namespace) return missing("Namespace is required.");
            return valid({ isNew: true, value: namespace });
        }
    }

    function handleNamespaceSelect(namespace: NewOrExisting<string> | null) {
        const validated =
            namespace === null ? missing<NewOrExisting<string>>("Namespace is required.") : valid(namespace);
        eventHandlers.onSetClusterNamespace(validated);
    }

    function handleNewNamespaceClick() {
        eventHandlers.onSetDialogContent({
            dialog: "newClusterNamespace",
            content: {
                namespace: fromNullable(state.newClusterNamespace),
            },
        });
        eventHandlers.onSetDialogVisibility({
            dialog: "newClusterNamespace",
            shown: true,
        });
    }

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.subscription)) return nothing();
        if (!isValid(state.location)) return nothing();
        if (!isValid(state.applicationName)) return nothing();
        if (!isValid(state.port)) return nothing();
        if (!isValid(state.clusterNamespace)) return nothing();
        if (!isValid(state.acrResourceGroup)) return nothing();
        if (!isValid(state.acr)) return nothing();
        if (!isValid(state.acrRepository)) return nothing();
        if (!isValid(state.acrRepoTag)) return nothing();

        const result: CreateParams = {
            subscriptionId: state.subscription.value.id,
            location: state.location.value,
            deploymentSpecType: state.deploymentSpecType,
            applicationName: state.applicationName.value,
            port: state.port.value,
            namespace: state.clusterNamespace.value.value,
            acrResourceGroup: state.acrResourceGroup.value,
            acrName: state.acr.value,
            repositoryName: state.acrRepository.value.value,
            tag: state.acrRepoTag.value.value,
        };

        return just(result);
    }

    function handleFormSubmit(e: FormEvent) {
        e.preventDefault();
        const createParams = validate();
        if (isNothing(createParams)) {
            return;
        }

        eventHandlers.onSetCreating();
        vscode.postCreateDeploymentRequest(createParams.value);
    }

    const [manifests, helm, kustomize]: DeploymentSpecType[] = ["manifests", "helm", "kustomize"];

    const lazyAllNamespaces = getNewAndExisting(lazyClusterNamespaces, state.newClusterNamespace);
    const lazyAllRepositories = getNewAndExisting(lazyRepositoryNames, state.newAcrRepository);
    const lazyAllImageTags = getNewAndExisting(lazyImageTags, state.newAcrRepoTag);

    const existingFiles = getExistingPaths(state.deploymentSpecType, state.existingFiles);

    return (
        <>
            <form className={styles.wrapper} onSubmit={handleFormSubmit}>
                <h2>Draft a deployment</h2>
                <p>
                    Enter the appropriate values in the fields below to enable Draft to automatically create Kubernetes
                    manifests, Helm charts, or Kustomize files for your application. Once created, you will be able to
                    deploy your application to your AKS (Azure Kubernetes Service) cluster.
                </p>

                <fieldset className={styles.inputContainer} disabled={state.status !== "Editing"}>
                    <h3 className={styles.fullWidth}>Azure resource details</h3>
                    <p className={styles.fullWidth}>
                        Select the Azure Container Registry (ACR) which will contain the image to use for your
                        deployment. You may also select an AKS cluster to choose a Kubernetes namespace to deploy to.
                    </p>
                    <label htmlFor="subscription-input" className={styles.label}>
                        Subscription *
                    </label>
                    <ResourceSelector<Subscription>
                        id="subscription-input"
                        className={styles.control}
                        resources={lazySubscriptions}
                        selectedItem={toNullable(state.subscription)}
                        valueGetter={(l) => l.id}
                        labelGetter={(l) => l.name}
                        onSelect={handleSubscriptionSelect}
                    />
                    {hasMessage(state.subscription) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.subscription.message}
                        </span>
                    )}

                    {isValid(state.subscription) && (
                        <>
                            <label htmlFor="acr-rg-input" className={styles.label}>
                                ACR Resource Group *
                            </label>
                            <ResourceSelector<string>
                                id="acr-rg-input"
                                className={styles.control}
                                resources={lazyAcrResourceGroups}
                                selectedItem={toNullable(state.acrResourceGroup)}
                                valueGetter={(g) => g}
                                labelGetter={(g) => g}
                                onSelect={handleAcrResourceGroupSelect}
                            />
                            {hasMessage(state.acrResourceGroup) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.acrResourceGroup.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.acrResourceGroup) && (
                        <>
                            <label htmlFor="acr-input" className={styles.label}>
                                Container Registry *
                            </label>
                            <ResourceSelector<string>
                                id="acr-input"
                                className={styles.control}
                                resources={lazyAcrNames}
                                selectedItem={toNullable(state.acr)}
                                valueGetter={(c) => c}
                                labelGetter={(c) => c}
                                onSelect={handleAcrSelect}
                            />
                            {hasMessage(state.acr) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.acr.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.acr) && (
                        <>
                            <label htmlFor="acr-repo-input" className={styles.label}>
                                Repository *
                            </label>
                            <ResourceSelector<NewOrExisting<string>>
                                id="acr-repo-input"
                                className={styles.control}
                                resources={lazyAllRepositories}
                                selectedItem={toNullable(state.acrRepository)}
                                valueGetter={(r) => r.value}
                                labelGetter={(r) => (r.isNew ? `(New) ${r.value}` : r.value)}
                                onSelect={handleRepositorySelect}
                            />

                            {isLoaded(lazyRepositoryNames) && (
                                <div className={styles.controlSupplement}>
                                    <VSCodeButton appearance="icon" onClick={handleNewRepositoryClick}>
                                        <span className={styles.iconButton}>
                                            <FontAwesomeIcon icon={faPlus} />
                                            &nbsp;Create new
                                        </span>
                                    </VSCodeButton>
                                </div>
                            )}

                            {hasMessage(state.acrRepository) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.acrRepository.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.acrRepository) && (
                        <>
                            <label htmlFor="acr-image-tag-input" className={styles.label}>
                                Image tag *
                            </label>
                            {!state.acrRepository.value.isNew && (
                                <>
                                    <ResourceSelector<NewOrExisting<string>>
                                        id="acr-image-tag-input"
                                        className={styles.control}
                                        resources={lazyAllImageTags}
                                        selectedItem={toNullable(state.acrRepoTag)}
                                        valueGetter={(r) => r.value}
                                        labelGetter={(r) => (r.isNew ? `(New) ${r.value}` : r.value)}
                                        onSelect={handleImageTagSelect}
                                    />

                                    {isLoaded(lazyImageTags) && (
                                        <div className={styles.controlSupplement}>
                                            <VSCodeButton appearance="icon" onClick={handleNewImageTagClick}>
                                                <span className={styles.iconButton}>
                                                    <FontAwesomeIcon icon={faPlus} />
                                                    &nbsp;Create new
                                                </span>
                                            </VSCodeButton>
                                        </div>
                                    )}
                                </>
                            )}

                            {state.acrRepository.value.isNew && (
                                <VSCodeTextField
                                    id="acr-image-tag-input"
                                    className={styles.control}
                                    value={isValid(state.acrRepoTag) ? state.acrRepoTag.value.value : ""}
                                    onBlur={handleImageTagChangeForNewRepository}
                                    onInput={handleImageTagChangeForNewRepository}
                                />
                            )}

                            {hasMessage(state.acrRepoTag) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.acrRepoTag.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.subscription) && (
                        <>
                            <label htmlFor="cluster-rg-input" className={styles.label}>
                                Cluster Resource Group
                            </label>
                            <ResourceSelector<string>
                                id="cluster-rg-input"
                                className={styles.control}
                                resources={lazyClusterResourceGroups}
                                selectedItem={state.clusterResourceGroup}
                                valueGetter={(g) => g}
                                labelGetter={(g) => g}
                                onSelect={eventHandlers.onSetClusterResourceGroup}
                            />
                        </>
                    )}

                    {state.clusterResourceGroup && (
                        <>
                            <label htmlFor="cluster-input" className={styles.label}>
                                Cluster
                            </label>
                            <ResourceSelector<string>
                                id="cluster-input"
                                className={styles.control}
                                resources={lazyClusterNames}
                                selectedItem={state.cluster}
                                valueGetter={(c) => c}
                                labelGetter={(c) => c}
                                onSelect={eventHandlers.onSetCluster}
                            />
                        </>
                    )}

                    <h3 className={styles.fullWidth}>Deployment details</h3>
                    <label htmlFor="location-input" className={styles.label}>
                        Location *
                    </label>
                    <VSCodeTextField
                        id="location-input"
                        readOnly
                        value={`.${state.workspaceConfig.pathSeparator}${state.location.value}`}
                        className={styles.control}
                    />
                    <div className={styles.controlSupplement}>
                        <VSCodeButton appearance="icon" onClick={handleChooseLocationClick}>
                            <span className={styles.iconButton}>
                                <FontAwesomeIcon icon={faFolder} />
                                &nbsp;Choose location
                            </span>
                        </VSCodeButton>
                    </div>
                    {hasMessage(state.location) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.location.message}
                        </span>
                    )}

                    <label htmlFor="deployment-type-input" className={styles.label}>
                        Deployment options *
                    </label>
                    <VSCodeRadioGroup
                        id="deployment-type-input"
                        className={styles.control}
                        value={state.deploymentSpecType}
                        orientation="vertical"
                        onChange={handleDeploymentSpecTypeChange}
                    >
                        <VSCodeRadio value={manifests}>Manifests</VSCodeRadio>
                        <VSCodeRadio value={helm}>Helm</VSCodeRadio>
                        <VSCodeRadio value={kustomize}>Kustomize</VSCodeRadio>
                    </VSCodeRadioGroup>

                    <label htmlFor="app-name-input" className={styles.label}>
                        Application name *
                    </label>
                    <VSCodeTextField
                        id="app-name-input"
                        value={orDefault(state.applicationName, "")}
                        className={styles.control}
                        onBlur={handleApplicationNameChange}
                        onInput={handleApplicationNameChange}
                    />
                    {hasMessage(state.applicationName) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.applicationName.message}
                        </span>
                    )}

                    <label htmlFor="port-input" className={styles.label}>
                        Application port *
                    </label>
                    <input
                        type="number"
                        id="port-input"
                        className={styles.control}
                        value={orDefault(state.port, "")}
                        onInput={handlePortChange}
                    />
                    {hasMessage(state.port) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.port.message}
                        </span>
                    )}

                    <label htmlFor="namespace-input" className={styles.label}>
                        Namespace *
                    </label>

                    {!isLoaded(lazyClusterNamespaces) && (
                        <VSCodeTextField
                            id="namespace-input"
                            value={state.newClusterNamespace || ""}
                            className={styles.control}
                            onBlur={handleNamespaceChange}
                            onInput={handleNamespaceChange}
                        />
                    )}

                    {isLoaded(lazyClusterNamespaces) && (
                        <>
                            <ResourceSelector<NewOrExisting<string>>
                                id="namespace-input"
                                className={styles.control}
                                resources={lazyAllNamespaces}
                                selectedItem={toNullable(state.clusterNamespace)}
                                valueGetter={(n) => n.value}
                                labelGetter={(n) => (n.isNew ? `(New) ${n.value}` : n.value)}
                                onSelect={handleNamespaceSelect}
                            />

                            <div className={styles.controlSupplement}>
                                <VSCodeButton appearance="icon" onClick={handleNewNamespaceClick}>
                                    <span className={styles.iconButton}>
                                        <FontAwesomeIcon icon={faPlus} />
                                        &nbsp;Create new
                                    </span>
                                </VSCodeButton>
                            </div>
                        </>
                    )}

                    {hasMessage(state.clusterNamespace) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.clusterNamespace.message}
                        </span>
                    )}
                </fieldset>

                <div className={styles.buttonContainer}>
                    <VSCodeButton type="submit" disabled={state.status !== "Editing" || isNothing(validate())}>
                        Create
                    </VSCodeButton>
                </div>

                {existingFiles.length > 0 && (
                    <>
                        <h3>Files</h3>
                        <ul className={styles.existingFileList}>
                            {existingFiles.map((path, i) => (
                                <li key={i}>
                                    <VSCodeLink
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            vscode.postOpenFileRequest(path);
                                        }}
                                    >
                                        {path}
                                    </VSCodeLink>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {state.status === "Created" && (
                    <div className={styles.nextStepsContainer}>
                        <i className={`codicon codicon-sparkle ${styles.icon}`}></i>
                        <div className={styles.content}>
                            <h3>Next steps</h3>

                            <p>
                                To generate a GitHub Action, you can run{" "}
                                <VSCodeLink
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        vscode.postLaunchCommand(VsCodeCommand.DraftWorkflow);
                                    }}
                                >
                                    Draft: Create a GitHub workflow
                                </VSCodeLink>
                                .
                            </p>
                        </div>
                    </div>
                )}
            </form>

            {isLoaded(lazyClusterNamespaces) && (
                <NewNamespaceDialog
                    state={state.allDialogsState.newClusterNamespaceState}
                    existingNamespaces={lazyClusterNamespaces.value}
                    eventHandlers={eventHandlers}
                    onSetNewClusterNamespace={eventHandlers.onSetNewClusterNamespace}
                />
            )}
            {isLoaded(lazyRepositoryNames) && (
                <NewRepositoryDialog
                    state={state.allDialogsState.newRepositoryState}
                    existingRepositories={lazyRepositoryNames.value}
                    eventHandlers={eventHandlers}
                    onSetNewAcrRepository={eventHandlers.onSetNewAcrRepository}
                />
            )}
            {isLoaded(lazyImageTags) && (
                <NewImageTagDialog
                    state={state.allDialogsState.newImageTagState}
                    existingTags={lazyImageTags.value}
                    eventHandlers={eventHandlers}
                    onSetNewAcrRepoTag={eventHandlers.onSetNewAcrRepoTag}
                />
            )}
        </>
    );
}

type LocalData = {
    lazySubscriptions: Lazy<Subscription[]>;
    lazyClusterResourceGroups: Lazy<string[]>;
    lazyClusterNames: Lazy<string[]>;
    lazyClusterNamespaces: Lazy<string[]>;
    lazyAcrResourceGroups: Lazy<string[]>;
    lazyAcrNames: Lazy<string[]>;
    lazyRepositoryNames: Lazy<string[]>;
    lazyImageTags: Lazy<string[]>;
};

function prepareData(state: DraftDeploymentState, updates: EventHandlerFunc[]): LocalData {
    const lazyClusters = ensureClustersLoaded(state.azureReferenceData, toNullable(state.subscription), updates);
    const lazyClusterResourceGroups = lazyMap(lazyClusters, (clusters) =>
        distinct(clusters.map((c) => c.resourceGroup)),
    );
    const lazyClusterNames = lazyMap(lazyClusters, (clusters) =>
        clusters.filter((c) => c.resourceGroup === state.clusterResourceGroup).map((c) => c.clusterName),
    );

    const lazyAcrs = ensureAcrsLoaded(state.azureReferenceData, toNullable(state.subscription), updates);
    const acrResourceGroup = toNullable(state.acrResourceGroup);
    const lazyAcrResourceGroups = lazyMap(lazyAcrs, (acrs) => distinct(acrs.map((a) => a.resourceGroup)));
    const lazyAcrNames = lazyMap(lazyAcrs, (acrs) =>
        acrs.filter((a) => a.resourceGroup === acrResourceGroup).map((a) => a.acrName),
    );
    return {
        lazySubscriptions: ensureSubscriptionsLoaded(state.azureReferenceData, updates),
        lazyClusterResourceGroups,
        lazyClusterNames,
        lazyAcrResourceGroups,
        lazyAcrNames,
        lazyRepositoryNames: ensureAcrRepositoryNamesLoaded(
            state.azureReferenceData,
            toNullable(state.subscription),
            toNullable(state.acrResourceGroup),
            toNullable(state.acr),
            updates,
        ),
        lazyImageTags: ensureAcrImageTagsLoaded(
            state.azureReferenceData,
            toNullable(state.subscription),
            toNullable(state.acrResourceGroup),
            toNullable(state.acr),
            isValid(state.acrRepository) && !state.acrRepository.value.isNew ? state.acrRepository.value.value : null,
            updates,
        ),
        lazyClusterNamespaces: ensureClusterNamespacesLoaded(
            state.azureReferenceData,
            toNullable(state.subscription),
            state.clusterResourceGroup,
            state.cluster,
            updates,
        ),
    };
}

function getNewAndExisting<T>(existing: Lazy<T[]>, newItem: T | null): Lazy<NewOrExisting<T>[]> {
    const wrappedExisting = lazyMap(existing, (items) => items.map((value) => ({ isNew: false, value })));
    return newItem !== null
        ? lazyMap(wrappedExisting, (items) => [{ isNew: true, value: newItem }, ...items])
        : wrappedExisting;
}
