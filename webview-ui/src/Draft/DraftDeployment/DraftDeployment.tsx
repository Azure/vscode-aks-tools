import { FormEvent, MouseEvent, useEffect } from "react";
import { CreateParams, InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDeployment";
import {
    DeploymentSpecType,
    NewOrExisting,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import styles from "../Draft.module.css";
import { useStateManagement } from "../../utilities/state";
import { DraftDeploymentState, getExistingPaths, stateUpdater, vscode } from "./state";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import {
    Validatable,
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
import { Lazy, map as lazyMap } from "../../utilities/lazy";
import { ResourceSelector } from "../../components/ResourceSelector";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import {
    VSCodeButton,
    VSCodeLink,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { faFolder } from "@fortawesome/free-regular-svg-icons";
import { distinct } from "../../utilities/array";
import { TextWithDropdown } from "../../components/TextWithDropdown";

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

    function handleRepositorySelect(repository: string | null, isNew: boolean) {
        const validated = getValidatedRepository();
        eventHandlers.onSetAcrRepository(validated);

        function getValidatedRepository(): Validatable<NewOrExisting<string>> {
            if (!repository) return missing("Azure Container Registry image is required.");
            return valid({ isNew, value: repository });
        }
    }

    function handleImageTagSelect(imageTag: string | null, isNew: boolean) {
        const validated = getValidatedImageTag();
        eventHandlers.onSetAcrRepoTag(validated);

        function getValidatedImageTag(): Validatable<NewOrExisting<string>> {
            if (!imageTag) return missing("Image tag is required.");
            return valid({ isNew, value: imageTag });
        }
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

    function handleTargetPortChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.currentTarget as HTMLInputElement;
        const port = parseInt(elem.value);
        const validated = getValidatedPort(port);
        eventHandlers.onSetTargetPort(validated);
    }

    function handleServicePortChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.currentTarget as HTMLInputElement;
        const port = parseInt(elem.value);
        const validated = getValidatedPort(port);
        eventHandlers.onSetServicePort(validated);
    }

    function getValidatedPort(port: number): Validatable<number> {
        if (Number.isNaN(port)) {
            return invalid(port, "Port must be a number.");
        }
        if (port < 1 || port > 65535) {
            return invalid(port, "Port number must be between 1 and 65535.");
        }

        return valid(port);
    }

    function handleNamespaceSelect(namespace: string | null, isNew: boolean) {
        const validated = getValidatedNamespace();
        eventHandlers.onSetClusterNamespace(validated);

        function getValidatedNamespace(): Validatable<NewOrExisting<string>> {
            if (!namespace) return missing("Namespace is required.");
            return valid({ isNew, value: namespace });
        }
    }

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.subscription)) return nothing();
        if (!isValid(state.location)) return nothing();
        if (!isValid(state.applicationName)) return nothing();
        if (!isValid(state.targetPort)) return nothing();
        if (!isValid(state.servicePort)) return nothing();
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
            targetPort: state.targetPort.value,
            servicePort: state.servicePort.value,
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

    function handleDraftWorkflowClick(e: MouseEvent) {
        e.preventDefault();
        vscode.postLaunchDraftWorkflow({
            initialSubscriptionId: isValid(state.subscription) ? state.subscription.value.id : null,
            initialAcrResourceGroup: orDefault(state.acrResourceGroup, null),
            initialAcrName: orDefault(state.acr, null),
            initialAcrRepository: isValid(state.acrRepository) ? state.acrRepository.value.value : null,
            initialClusterResourceGroup: state.clusterResourceGroup,
            initialClusterName: state.cluster,
            initialClusterNamespace: isValid(state.clusterNamespace) ? state.clusterNamespace.value.value : null,
            initialDeploymentSpecType: state.deploymentSpecType,
            deploymentLocation: state.location.value,
        });
    }

    const [manifests, helm, kustomize]: DeploymentSpecType[] = ["manifests", "helm", "kustomize"];

    const lazyAllNamespaces = getNewAndExisting(lazyClusterNamespaces, state.newClusterNamespace);
    const lazyAllRepositories = getNewAndExisting(lazyRepositoryNames, state.newAcrRepository);
    const lazyAllImageTags = getNewAndExisting(lazyImageTags, state.newAcrRepoTag);

    const existingFiles = getExistingPaths(state.deploymentSpecType, state.existingFiles);

    const acrImageTooltipMessage =
        "If you choose to use Draft's GitHub Action workflow for your deployment, it will automatically create and deploy the new resources through the workflow. The workflow can build new images and deploy to new namespaces.";

    const clusterResourceGroupTooltipMessage =
        "You can select a resource group and cluster here if you wish to select an existing Kubernetes namespace to deploy to.\n\nLeave this field blank to specify a namespace that does not exist yet.";

    const clusterNamespaceTooltipMessage =
        "If you choose to use Draft's GitHub Action workflow for your deployment, it will create this namespace when it runs.";

    const targetPortTooltipMessage =
        "The port on which your application listens in the deployment.\n\nThis will typically match the port exposed in the Dockerfile.";

    const servicePortTooltipMessage = "The port on which the service will listen for incoming traffic.";

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
                                Azure Container Registry image *
                                <span className={"tooltip-holder"} data-tooltip-text={acrImageTooltipMessage}>
                                    <i className={`${styles.inlineIcon} codicon codicon-info`} />
                                </span>
                            </label>
                            <TextWithDropdown
                                id="acr-repo-input"
                                className={styles.control}
                                getAddItemText={(text) => `Use "${text}"`}
                                items={lazyMap(lazyAllRepositories, (repos) => repos.map((r) => r.value))}
                                selectedItem={toNullable(state.acrRepository)?.value || null}
                                onSelect={handleRepositorySelect}
                            />

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
                                <TextWithDropdown
                                    id="acr-image-tag-input"
                                    className={styles.control}
                                    getAddItemText={(text) => `Use "${text}"`}
                                    items={lazyMap(lazyAllImageTags, (tags) => tags.map((t) => t.value))}
                                    selectedItem={toNullable(state.acrRepoTag)?.value || null}
                                    onSelect={handleImageTagSelect}
                                />
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
                                <span
                                    className={"tooltip-holder"}
                                    data-tooltip-text={clusterResourceGroupTooltipMessage}
                                >
                                    <i className={`${styles.inlineIcon} codicon codicon-info`} />
                                </span>
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

                    <label htmlFor="target-port-input" className={styles.label}>
                        Target port *
                        <span className={"tooltip-holder"} data-tooltip-text={targetPortTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>
                    <input
                        type="number"
                        id="target-port-input"
                        className={styles.control}
                        value={orDefault(state.targetPort, "")}
                        onInput={handleTargetPortChange}
                    />
                    {hasMessage(state.targetPort) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.targetPort.message}
                        </span>
                    )}

                    <label htmlFor="service-port-input" className={styles.label}>
                        Service port *
                        <span className={"tooltip-holder"} data-tooltip-text={servicePortTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>
                    <input
                        type="number"
                        id="service-port-input"
                        className={styles.control}
                        value={orDefault(state.servicePort, "")}
                        onInput={handleServicePortChange}
                    />
                    {hasMessage(state.servicePort) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.servicePort.message}
                        </span>
                    )}

                    <label htmlFor="namespace-input" className={styles.label}>
                        Namespace *
                        <span className={"tooltip-holder"} data-tooltip-text={clusterNamespaceTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>

                    <TextWithDropdown
                        id="namespace-input"
                        className={styles.control}
                        getAddItemText={(text) => `Use "${text}"`}
                        items={lazyMap(lazyAllNamespaces, (namespaces) => namespaces.map((n) => n.value))}
                        selectedItem={toNullable(state.clusterNamespace)?.value || null}
                        onSelect={handleNamespaceSelect}
                    />

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
                                <VSCodeLink href="#" onClick={handleDraftWorkflowClick}>
                                    Draft: Create a GitHub workflow
                                </VSCodeLink>
                                .
                            </p>
                        </div>
                    </div>
                )}
            </form>
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
