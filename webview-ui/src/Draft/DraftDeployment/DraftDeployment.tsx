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
        eventHandlers.onSetSelectedSubscription(validated);
    }

    function handleAcrResourceGroupSelect(resourceGroup: string | null) {
        const validated =
            resourceGroup === null ? missing<string>("ACR resource group is required.") : valid(resourceGroup);
        eventHandlers.onSetSelectedAcrResourceGroup(validated);
    }

    function handleAcrSelect(acr: string | null) {
        const validated = acr === null ? missing<string>("ACR is required.") : valid(acr);
        eventHandlers.onSetSelectedAcr(validated);
    }

    function handleRepositorySelect(repository: string | null, isNew: boolean) {
        const validated = getValidatedRepository();
        eventHandlers.onSetSelectedAcrRepository(validated);

        function getValidatedRepository(): Validatable<NewOrExisting<string>> {
            if (!repository) return missing("Azure Container Registry image is required.");
            return valid({ isNew, value: repository });
        }
    }

    function handleImageTagSelect(imageTag: string | null, isNew: boolean) {
        const validated = getValidatedImageTag();
        eventHandlers.onSetSelectedAcrRepoTag(validated);

        function getValidatedImageTag(): Validatable<NewOrExisting<string>> {
            if (!imageTag) return missing("Image tag is required.");
            return valid({ isNew, value: imageTag });
        }
    }

    function handleImageTagChangeForNewRepository(e: Event | FormEvent<HTMLElement>) {
        const value = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedImageTagForNewRepository(value);
        eventHandlers.onSetSelectedAcrRepoTag(validated);

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
        eventHandlers.onSetSelectedDeploymentSpecType(type);
    }

    function handleApplicationNameChange(e: Event | FormEvent<HTMLElement>) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedApplicationName(name);
        eventHandlers.onSetSelectedApplicationName(validated);

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
        eventHandlers.onSetSelectedTargetPort(validated);
    }

    function handleServicePortChange(e: Event | FormEvent<HTMLElement>) {
        const elem = e.currentTarget as HTMLInputElement;
        const port = parseInt(elem.value);
        const validated = getValidatedPort(port);
        eventHandlers.onSetSelectedServicePort(validated);
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
        eventHandlers.onSetSelectedClusterNamespace(validated);

        function getValidatedNamespace(): Validatable<NewOrExisting<string>> {
            if (!namespace) return missing("Namespace is required.");
            return valid({ isNew, value: namespace });
        }
    }

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.selectedSubscription)) return nothing();
        if (!isValid(state.selectedLocation)) return nothing();
        if (!isValid(state.selectedApplicationName)) return nothing();
        if (!isValid(state.selectedTargetPort)) return nothing();
        if (!isValid(state.selectedServicePort)) return nothing();
        if (!isValid(state.selectedClusterNamespace)) return nothing();
        if (!isValid(state.selectedAcrResourceGroup)) return nothing();
        if (!isValid(state.selectedAcr)) return nothing();
        if (!isValid(state.selectedAcrRepository)) return nothing();
        if (!isValid(state.selectedAcrRepoTag)) return nothing();

        const result: CreateParams = {
            subscriptionId: state.selectedSubscription.value.id,
            location: state.selectedLocation.value,
            deploymentSpecType: state.selectedDeploymentSpecType,
            applicationName: state.selectedApplicationName.value,
            targetPort: state.selectedTargetPort.value,
            servicePort: state.selectedServicePort.value,
            namespace: state.selectedClusterNamespace.value.value,
            acrResourceGroup: state.selectedAcrResourceGroup.value,
            acrName: state.selectedAcr.value,
            repositoryName: state.selectedAcrRepository.value.value,
            tag: state.selectedAcrRepoTag.value.value,
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
            initialSubscriptionId: isValid(state.selectedSubscription) ? state.selectedSubscription.value.id : null,
            initialAcrResourceGroup: orDefault(state.selectedAcrResourceGroup, null),
            initialAcrName: orDefault(state.selectedAcr, null),
            initialAcrRepository: isValid(state.selectedAcrRepository) ? state.selectedAcrRepository.value.value : null,
            initialClusterResourceGroup: state.selectedClusterResourceGroup,
            initialClusterName: state.selectedCluster,
            initialClusterNamespace: isValid(state.selectedClusterNamespace)
                ? state.selectedClusterNamespace.value.value
                : null,
            initialDeploymentSpecType: state.selectedDeploymentSpecType,
            deploymentLocation: state.selectedLocation.value,
        });
    }

    const [manifests, helm, kustomize]: DeploymentSpecType[] = ["manifests", "helm", "kustomize"];
    const existingFiles = getExistingPaths(state.selectedDeploymentSpecType, state.existingFiles);

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

                    {isValid(state.selectedSubscription) && (
                        <>
                            <label htmlFor="acr-rg-input" className={styles.label}>
                                ACR Resource Group *
                            </label>
                            <ResourceSelector<string>
                                id="acr-rg-input"
                                className={styles.control}
                                resources={lazyAcrResourceGroups}
                                selectedItem={toNullable(state.selectedAcrResourceGroup)}
                                valueGetter={(g) => g}
                                labelGetter={(g) => g}
                                onSelect={handleAcrResourceGroupSelect}
                            />
                            {hasMessage(state.selectedAcrResourceGroup) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.selectedAcrResourceGroup.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.selectedAcrResourceGroup) && (
                        <>
                            <label htmlFor="acr-input" className={styles.label}>
                                Container Registry *
                            </label>
                            <ResourceSelector<string>
                                id="acr-input"
                                className={styles.control}
                                resources={lazyAcrNames}
                                selectedItem={toNullable(state.selectedAcr)}
                                valueGetter={(c) => c}
                                labelGetter={(c) => c}
                                onSelect={handleAcrSelect}
                            />
                            {hasMessage(state.selectedAcr) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.selectedAcr.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.selectedAcr) && (
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
                                items={lazyRepositoryNames}
                                selectedItem={toNullable(state.selectedAcrRepository)?.value || null}
                                onSelect={handleRepositorySelect}
                            />

                            {hasMessage(state.selectedAcrRepository) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.selectedAcrRepository.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.selectedAcrRepository) && (
                        <>
                            <label htmlFor="acr-image-tag-input" className={styles.label}>
                                Image tag *
                            </label>
                            {!state.selectedAcrRepository.value.isNew && (
                                <TextWithDropdown
                                    id="acr-image-tag-input"
                                    className={styles.control}
                                    getAddItemText={(text) => `Use "${text}"`}
                                    items={lazyImageTags}
                                    selectedItem={toNullable(state.selectedAcrRepoTag)?.value || null}
                                    onSelect={handleImageTagSelect}
                                />
                            )}

                            {state.selectedAcrRepository.value.isNew && (
                                <VSCodeTextField
                                    id="acr-image-tag-input"
                                    className={styles.control}
                                    value={
                                        isValid(state.selectedAcrRepoTag) ? state.selectedAcrRepoTag.value.value : ""
                                    }
                                    onBlur={handleImageTagChangeForNewRepository}
                                    onInput={handleImageTagChangeForNewRepository}
                                />
                            )}

                            {hasMessage(state.selectedAcrRepoTag) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.selectedAcrRepoTag.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.selectedSubscription) && (
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
                                selectedItem={state.selectedClusterResourceGroup}
                                valueGetter={(g) => g}
                                labelGetter={(g) => g}
                                onSelect={eventHandlers.onSetSelectedClusterResourceGroup}
                            />
                        </>
                    )}

                    {state.selectedClusterResourceGroup && (
                        <>
                            <label htmlFor="cluster-input" className={styles.label}>
                                Cluster
                            </label>
                            <ResourceSelector<string>
                                id="cluster-input"
                                className={styles.control}
                                resources={lazyClusterNames}
                                selectedItem={state.selectedCluster}
                                valueGetter={(c) => c}
                                labelGetter={(c) => c}
                                onSelect={eventHandlers.onSetSelectedCluster}
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
                        value={`.${state.workspaceConfig.pathSeparator}${state.selectedLocation.value}`}
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
                    {hasMessage(state.selectedLocation) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedLocation.message}
                        </span>
                    )}

                    <label htmlFor="deployment-type-input" className={styles.label}>
                        Deployment options *
                    </label>
                    <VSCodeRadioGroup
                        id="deployment-type-input"
                        className={styles.control}
                        value={state.selectedDeploymentSpecType}
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
                        value={orDefault(state.selectedApplicationName, "")}
                        className={styles.control}
                        onBlur={handleApplicationNameChange}
                        onInput={handleApplicationNameChange}
                    />
                    {hasMessage(state.selectedApplicationName) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedApplicationName.message}
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
                        value={orDefault(state.selectedTargetPort, "")}
                        onInput={handleTargetPortChange}
                    />
                    {hasMessage(state.selectedTargetPort) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedTargetPort.message}
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
                        value={orDefault(state.selectedServicePort, "")}
                        onInput={handleServicePortChange}
                    />
                    {hasMessage(state.selectedServicePort) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedServicePort.message}
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
                        items={lazyClusterNamespaces}
                        selectedItem={toNullable(state.selectedClusterNamespace)?.value || null}
                        onSelect={handleNamespaceSelect}
                    />

                    {hasMessage(state.selectedClusterNamespace) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.selectedClusterNamespace.message}
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
    const lazyClusters = ensureClustersLoaded(
        state.azureReferenceData,
        toNullable(state.selectedSubscription),
        updates,
    );
    const lazyClusterResourceGroups = lazyMap(lazyClusters, (clusters) =>
        distinct(clusters.map((c) => c.resourceGroup)),
    );
    const lazyClusterNames = lazyMap(lazyClusters, (clusters) =>
        clusters.filter((c) => c.resourceGroup === state.selectedClusterResourceGroup).map((c) => c.clusterName),
    );

    const lazyAcrs = ensureAcrsLoaded(state.azureReferenceData, toNullable(state.selectedSubscription), updates);
    const acrResourceGroup = toNullable(state.selectedAcrResourceGroup);
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
            toNullable(state.selectedSubscription),
            toNullable(state.selectedAcrResourceGroup),
            toNullable(state.selectedAcr),
            updates,
        ),
        lazyImageTags: ensureAcrImageTagsLoaded(
            state.azureReferenceData,
            toNullable(state.selectedSubscription),
            toNullable(state.selectedAcrResourceGroup),
            toNullable(state.selectedAcr),
            isValid(state.selectedAcrRepository) && !state.selectedAcrRepository.value.isNew
                ? state.selectedAcrRepository.value.value
                : null,
            updates,
        ),
        lazyClusterNamespaces: ensureClusterNamespacesLoaded(
            state.azureReferenceData,
            toNullable(state.selectedSubscription),
            state.selectedClusterResourceGroup,
            state.selectedCluster,
            updates,
        ),
    };
}
