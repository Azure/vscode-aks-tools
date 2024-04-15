import { FormEvent, useEffect } from "react";
import { CreateParams, InitialState } from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    DeploymentSpecType,
    ForkInfo,
    HelmDeploymentParams,
    HelmOverride,
    ManifestsDeploymentParams,
    NewOrExisting,
    Subscription,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { Lazy, map as lazyMap } from "../../utilities/lazy";
import {
    Validatable,
    hasMessage,
    invalid,
    isValid,
    isValueSet,
    missing,
    orDefault,
    toNullable,
    unset,
    valid,
} from "../../utilities/validation";
import {
    EventHandlerFunc,
    ensureAcrsLoaded,
    ensureAcrRepositoryNamesLoaded,
    ensureClustersLoaded,
    ensureClusterNamespacesLoaded,
    ensureForkBranchNamesLoaded,
    ensureSubscriptionsLoaded,
} from "./dataLoading";
import { DraftWorkflowState, HelmOverrideState, stateUpdater, vscode } from "./state";
import { useStateManagement } from "../../utilities/state";
import styles from "../Draft.module.css";
import { Maybe, isNothing, just, nothing } from "../../utilities/maybe";
import { ResourceSelector } from "../../components/ResourceSelector";
import {
    VSCodeButton,
    VSCodeLink,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTimesCircle, faTrash } from "@fortawesome/free-solid-svg-icons";
import { faFolder } from "@fortawesome/free-regular-svg-icons";
import { distinct, filterNulls, replaceItem } from "../../utilities/array";
import { TextWithDropdown } from "../../components/TextWithDropdown";

export function DraftWorkflow(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    const updates: EventHandlerFunc[] = [];
    const {
        lazyBranchNames,
        lazySubscriptions,
        lazyClusterResourceGroups,
        lazyClusterNames,
        lazyNamespaces,
        lazyAcrResourceGroups,
        lazyAcrNames,
        lazyRepositoryNames,
    } = prepareData(state, updates);
    useEffect(() => {
        updates.map((fn) => fn(eventHandlers));
    });

    function handleWorkflowNameChange(e: Event | FormEvent<HTMLElement>) {
        const name = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedWorkflowName(name);
        eventHandlers.onSetWorkflowName(validated);

        function getValidatedWorkflowName(name: string): Validatable<string> {
            if (!name) return missing("Workflow name is required.");

            // TODO: valid filename checking
            if (state.existingWorkflowFiles.some((f) => f.name === name)) {
                return invalid(name, "Workflow with this name already exists.");
            }

            return valid(name);
        }
    }

    function handleForkSelect(fork: ForkInfo | null) {
        const validated = fork === null ? missing<ForkInfo>("Fork is required.") : valid(fork);
        eventHandlers.onSetFork(validated);
    }

    function handleBranchSelect(branch: string | null) {
        const validated = branch === null ? missing<string>("Branch is required.") : valid(branch);
        eventHandlers.onSetBranchName(validated);
    }

    function handleSubscriptionSelect(subscription: Subscription | null) {
        const validated =
            subscription === null ? missing<Subscription>("Subscription is required.") : valid(subscription);
        eventHandlers.onSetSubscription(validated);
    }

    function handleChooseDockerfileClick() {
        vscode.postPickFilesRequest({
            identifier: "Dockerfile",
            options: {
                defaultPath: state.workspaceConfig.fullPath,
                type: "file",
                title: "Dockerfile",
                buttonLabel: "Select",
                filters: { Dockerfile: ["Dockerfile"] },
            },
        });
    }

    function handleChooseBuildContextClick() {
        vscode.postPickFilesRequest({
            identifier: "BuildContext",
            options: {
                defaultPath: state.workspaceConfig.fullPath,
                type: "directory",
                title: "Build context path",
                buttonLabel: "Select",
            },
        });
    }

    function handleAcrResourceGroupSelect(resourceGroup: string | null) {
        const validated =
            resourceGroup === null ? missing<string>("ACR Resource Group is required.") : valid(resourceGroup);
        eventHandlers.onSetAcrResourceGroup(validated);
    }

    function handleAcrSelect(acr: string | null) {
        const validated = acr === null ? missing<string>("ACR is required.") : valid(acr);
        eventHandlers.onSetAcr(validated);
    }

    function handleRepositorySelect(repository: string | null, isNew: boolean) {
        const validated = getValidatedRepository();
        eventHandlers.onSetRepositoryName(validated);

        function getValidatedRepository(): Validatable<NewOrExisting<string>> {
            if (!repository) return missing("Repository name is required.");
            return valid({ isNew, value: repository });
        }
    }

    function handleClusterResourceGroupSelect(resourceGroup: string | null) {
        const validated =
            resourceGroup === null ? missing<string>("Cluster Resource Group is required.") : valid(resourceGroup);
        eventHandlers.onSetClusterResourceGroup(validated);
    }

    function handleClusterSelect(cluster: string | null) {
        const validated = cluster === null ? missing<string>("Cluster is required.") : valid(cluster);
        eventHandlers.onSetCluster(validated);
    }

    function handleNamespaceSelect(namespace: string | null, isNew: boolean) {
        const validated = getValidatedNamespace();
        eventHandlers.onSetNamespace(validated);

        function getValidatedNamespace(): Validatable<NewOrExisting<string>> {
            if (!namespace) return missing("Namespace is required.");
            return valid({ isNew, value: namespace });
        }
    }

    function handleDeploymentSpecTypeChange(e: Event | FormEvent<HTMLElement>) {
        const type = (e.currentTarget as HTMLInputElement).value as DeploymentSpecType;
        eventHandlers.onSetDeploymentSpecType(type);
    }

    function handleChooseManifestPathsClick() {
        vscode.postPickFilesRequest({
            identifier: "Manifests",
            options: {
                defaultPath: state.workspaceConfig.fullPath,
                type: "file",
                title: "Manifests",
                buttonLabel: "Select",
                filters: { YAML: ["yaml", "yml"] },
                canSelectMany: true,
            },
        });
    }

    function handleDeleteManifestPathClick(path: string) {
        if (isValid(state.manifestsParamsState.manifestPaths)) {
            const currentPaths = state.manifestsParamsState.manifestPaths.value;
            const newPaths = currentPaths.filter((p) => p !== path);
            if (newPaths.length === 0) {
                eventHandlers.onSetManifestPaths(missing("Manifest paths are required."));
            } else {
                eventHandlers.onSetManifestPaths(valid(newPaths));
            }
        }
    }

    function handleChooseHelmChartFolderClick() {
        vscode.postPickFilesRequest({
            identifier: "HelmCharts",
            options: {
                defaultPath: state.workspaceConfig.fullPath,
                type: "directory",
                title: "Helm charts folder",
                buttonLabel: "Select",
            },
        });
    }

    function handleChooseHelmValuesFileClick() {
        vscode.postPickFilesRequest({
            identifier: "HelmValuesYaml",
            options: {
                defaultPath: state.workspaceConfig.fullPath,
                type: "file",
                title: "Helm Values.yaml file",
                buttonLabel: "Select",
                filters: { YAML: ["yaml", "yml"] },
            },
        });
    }

    function handleOverrideKeyChange(e: Event | FormEvent<HTMLElement>, override: HelmOverrideState) {
        const key = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedOverrideKey(key);
        const overrides = replaceItem(
            state.helmParamsState.overrides,
            (o) => o === override,
            (o) => ({ ...o, key: validated }),
        );
        eventHandlers.onSetHelmOverrides(overrides);

        function getValidatedOverrideKey(key: string): Validatable<string> {
            key = key.trim();

            if (!key) return missing("Key is required.");
            const otherKeys = state.helmParamsState.overrides
                .filter((o) => o !== override)
                .map((o) => o.key)
                .filter(isValueSet)
                .map((k) => k.value);
            if (otherKeys.includes(key)) return invalid(key, "Key already exists.");

            // TODO: valid key checking
            return valid(key);
        }
    }

    function handleOverrideValueChange(e: Event | FormEvent<HTMLElement>, override: HelmOverrideState) {
        const value = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedOverrideValue(value);
        const overrides = replaceItem(
            state.helmParamsState.overrides,
            (o) => o === override,
            (o) => ({ ...o, value: validated }),
        );
        eventHandlers.onSetHelmOverrides(overrides);

        function getValidatedOverrideValue(value: string): Validatable<string> {
            if (!value) return missing("Value is required.");

            // TODO: Valid value checking
            return valid(value);
        }
    }

    function handleDeleteOverrideClick(override: HelmOverrideState) {
        const overrides = state.helmParamsState.overrides.filter((o) => o !== override);
        eventHandlers.onSetHelmOverrides(overrides);
    }

    function handleAddHelmOverrideClick() {
        eventHandlers.onSetHelmOverrides([...state.helmParamsState.overrides, { key: unset(), value: unset() }]);
    }

    function validate(): Maybe<CreateParams> {
        if (!isValid(state.workflowName)) return nothing();
        if (!isValid(state.branchName)) return nothing();
        if (!isValid(state.subscription)) return nothing();
        if (!isValid(state.dockerfilePath)) return nothing();
        if (!isValid(state.acrResourceGroup)) return nothing();
        if (!isValid(state.acr)) return nothing();
        if (!isValid(state.repositoryName)) return nothing();
        if (!isValid(state.clusterResourceGroup)) return nothing();
        if (!isValid(state.cluster)) return nothing();
        if (!isValid(state.namespace)) return nothing();

        const deploymentParams = validateDeploymentParams();
        if (isNothing(deploymentParams)) return nothing();

        const result: CreateParams = {
            workflowName: state.workflowName.value,
            branchName: state.branchName.value,
            subscriptionId: state.subscription.value.id,
            dockerfilePath: state.dockerfilePath.value,
            buildContextPath: state.buildContextPath,
            acrResourceGroup: state.acrResourceGroup.value,
            acrName: state.acr.value,
            repositoryName: state.repositoryName.value.value,
            clusterResourceGroup: state.clusterResourceGroup.value,
            clusterName: state.cluster.value,
            namespace: state.namespace.value.value,
            deploymentParams: deploymentParams.value,
        };

        return just(result);
    }

    function validateDeploymentParams(): Maybe<ManifestsDeploymentParams | HelmDeploymentParams> {
        switch (state.deploymentSpecType) {
            case "manifests": {
                if (!isValid(state.manifestsParamsState.manifestPaths)) return nothing();
                return just({
                    deploymentType: "manifests",
                    manifestPaths: state.manifestsParamsState.manifestPaths.value,
                });
            }
            case "helm": {
                if (!isValid(state.helmParamsState.chartPath)) return nothing();
                if (!isValid(state.helmParamsState.valuesYamlPath)) return nothing();
                const overrides = validateHelmOverrides(state.helmParamsState.overrides);
                if (isNothing(overrides)) return nothing();
                return just({
                    deploymentType: "helm",
                    chartPath: state.helmParamsState.chartPath.value,
                    valuesYamlPath: state.helmParamsState.valuesYamlPath.value,
                    overrides: overrides.value,
                });
            }
            default:
                return nothing();
        }
    }

    function validateHelmOverrides(overridesState: HelmOverrideState[]): Maybe<HelmOverride[]> {
        const overrides: (HelmOverride | null)[] = overridesState.map((o) => {
            if (!isValid(o.key) || !isValid(o.value)) return null;
            return { key: o.key.value, value: o.value.value };
        });
        if (overrides.some((o) => o === null)) return nothing();
        return just(filterNulls(overrides));
    }

    function handleFormSubmit(e: FormEvent) {
        e.preventDefault();
        const createParams = validate();
        if (isNothing(createParams)) {
            return;
        }

        eventHandlers.onSetCreating();
        vscode.postCreateWorkflowRequest(createParams.value);
    }

    const [manifests, helm]: DeploymentSpecType[] = ["manifests", "helm"];

    const lazyAllNamespaces = getNewAndExisting(lazyNamespaces, state.newNamespace);
    const lazyAllRepositories = getNewAndExisting(lazyRepositoryNames, state.newRepositoryName);

    const existingFile = state.existingFile;

    const forkTooltipMessage =
        "Select the primary/upstream fork of this repository.\n\nThis will allow you to select which branch will trigger the workflow.";

    return (
        <>
            <form className={styles.wrapper} onSubmit={handleFormSubmit}>
                <p className={styles.fullWidth}>
                    Generate a workflow to deploy to Azure Kubernetes Service (AKS). Before running this command, make
                    sure you have run Draft Create and Draft Setup GitHub OpenID Connect (OIDC) to generate the
                    necessary deployment files an authorize GitHub to access resources in Azure. You need a resource
                    group, container registry and an AKS Cluster created on Azure and link the resources.
                </p>

                <h3 className={styles.fullWidth}>Workflow properties</h3>
                <fieldset className={styles.inputContainer} disabled={state.status !== "Editing"}>
                    <label htmlFor="workflow-name-input" className={styles.label}>
                        Workflow name *
                    </label>
                    <VSCodeTextField
                        id="workflow-name-input"
                        value={orDefault(state.workflowName, "")}
                        className={styles.control}
                        onBlur={handleWorkflowNameChange}
                        onInput={handleWorkflowNameChange}
                    />
                    {hasMessage(state.workflowName) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.workflowName.message}
                        </span>
                    )}

                    <label htmlFor="fork-input">
                        Fork *
                        <span className={`tooltip-holder ${styles.label}`} data-tooltip-text={forkTooltipMessage}>
                            <i className={`${styles.inlineIcon} codicon codicon-info`} />
                        </span>
                    </label>
                    <ResourceSelector<ForkInfo>
                        id="fork-input"
                        className={styles.control}
                        resources={state.gitHubReferenceData.forks.map((f) => f.fork)}
                        selectedItem={toNullable(state.fork)}
                        valueGetter={(f) => f.name}
                        labelGetter={(f) => `${f.name} (${f.owner})`}
                        onSelect={handleForkSelect}
                    />

                    {isValid(state.fork) && (
                        <>
                            <label htmlFor="branch-input" className={styles.label}>
                                Branch *
                            </label>
                            <ResourceSelector<string>
                                id="branch-input"
                                className={styles.control}
                                resources={lazyBranchNames}
                                selectedItem={toNullable(state.branchName)}
                                valueGetter={(b) => b}
                                labelGetter={(b) => b}
                                onSelect={handleBranchSelect}
                            />
                            {hasMessage(state.branchName) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.branchName.message}
                                </span>
                            )}
                        </>
                    )}

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

                    <h3 className={styles.fullWidth}>Build details</h3>

                    <label htmlFor="dockerfile-input" className={styles.label}>
                        Dockerfile *
                    </label>
                    <VSCodeTextField
                        id="dockerfile-input"
                        value={
                            isValueSet(state.dockerfilePath)
                                ? `.${state.workspaceConfig.pathSeparator}${state.dockerfilePath.value}`
                                : ""
                        }
                        readOnly
                        className={styles.control}
                    />
                    <div className={styles.controlSupplement}>
                        <VSCodeButton appearance="icon" onClick={handleChooseDockerfileClick}>
                            <span className={styles.iconButton}>
                                <FontAwesomeIcon icon={faFolder} />
                                &nbsp;Choose Dockerfile
                            </span>
                        </VSCodeButton>
                    </div>
                    {hasMessage(state.dockerfilePath) && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                            {state.dockerfilePath.message}
                        </span>
                    )}

                    <label htmlFor="build-context-input" className={styles.label}>
                        Build context *
                    </label>
                    <VSCodeTextField
                        id="build-context-input"
                        value={`.${state.workspaceConfig.pathSeparator}${state.buildContextPath}`}
                        readOnly
                        className={styles.control}
                    />
                    <div className={styles.controlSupplement}>
                        <VSCodeButton appearance="icon" onClick={handleChooseBuildContextClick}>
                            <span className={styles.iconButton}>
                                <FontAwesomeIcon icon={faFolder} />
                                &nbsp;Choose build context
                            </span>
                        </VSCodeButton>
                    </div>

                    {isValid(state.subscription) && (
                        <>
                            <h3 className={styles.fullWidth}>Azure Container Registry details</h3>
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
                            </label>

                            <TextWithDropdown
                                id="acr-repo-input"
                                className={styles.control}
                                getAddItemText={(text) => `Use "${text}"`}
                                items={lazyMap(lazyAllRepositories, (repos) => repos.map((r) => r.value))}
                                selectedItem={toNullable(state.repositoryName)?.value || null}
                                onSelect={handleRepositorySelect}
                            />

                            {hasMessage(state.repositoryName) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.repositoryName.message}
                                </span>
                            )}
                        </>
                    )}

                    <h3 className={styles.fullWidth}>Deployment details</h3>

                    {isValid(state.subscription) && (
                        <>
                            <label htmlFor="cluster-rg-input" className={styles.label}>
                                Cluster Resource Group *
                            </label>
                            <ResourceSelector<string>
                                id="cluster-rg-input"
                                className={styles.control}
                                resources={lazyClusterResourceGroups}
                                selectedItem={toNullable(state.clusterResourceGroup)}
                                valueGetter={(g) => g}
                                labelGetter={(g) => g}
                                onSelect={handleClusterResourceGroupSelect}
                            />
                            {hasMessage(state.clusterResourceGroup) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.clusterResourceGroup.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.clusterResourceGroup) && (
                        <>
                            <label htmlFor="cluster-input" className={styles.label}>
                                Cluster *
                            </label>
                            <ResourceSelector<string>
                                id="cluster-input"
                                className={styles.control}
                                resources={lazyClusterNames}
                                selectedItem={toNullable(state.cluster)}
                                valueGetter={(c) => c}
                                labelGetter={(c) => c}
                                onSelect={handleClusterSelect}
                            />
                            {hasMessage(state.cluster) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.cluster.message}
                                </span>
                            )}
                        </>
                    )}

                    {isValid(state.cluster) && (
                        <>
                            <label htmlFor="namespace-input" className={styles.label}>
                                Namespace *
                            </label>

                            <TextWithDropdown
                                id="namespace-input"
                                className={styles.control}
                                getAddItemText={(text) => `Use "${text}"`}
                                items={lazyMap(lazyAllNamespaces, (namespaces) => namespaces.map((n) => n.value))}
                                selectedItem={toNullable(state.namespace)?.value || null}
                                onSelect={handleNamespaceSelect}
                            />

                            {hasMessage(state.namespace) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.namespace.message}
                                </span>
                            )}
                        </>
                    )}

                    <label htmlFor="deployment-type-input" className={styles.label}>
                        Type
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
                    </VSCodeRadioGroup>

                    {state.deploymentSpecType === "manifests" && (
                        <>
                            <label htmlFor="manifest-paths" className={styles.label}>
                                Manifest file paths *
                            </label>
                            <div className={styles.control}>
                                <VSCodeButton appearance="icon" onClick={handleChooseManifestPathsClick}>
                                    <span className={styles.iconButton}>
                                        <FontAwesomeIcon icon={faFolder} />
                                        &nbsp;Choose manifest file paths
                                    </span>
                                </VSCodeButton>
                            </div>
                            {isValid(state.manifestsParamsState.manifestPaths) && (
                                <ul className={`${styles.existingFileList} ${styles.control}`} id="manifest-paths">
                                    {state.manifestsParamsState.manifestPaths.value.map((path, i) => (
                                        <li key={i} className={styles.removable}>
                                            <VSCodeLink
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    vscode.postOpenFileRequest(path);
                                                }}
                                            >
                                                {path}
                                            </VSCodeLink>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => handleDeleteManifestPathClick(path)}
                                                aria-label="Delete"
                                                title="Delete"
                                            >
                                                <span className={styles.iconButton}>
                                                    <FontAwesomeIcon icon={faTrash} />
                                                </span>
                                            </VSCodeButton>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {hasMessage(state.manifestsParamsState.manifestPaths) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.manifestsParamsState.manifestPaths.message}
                                </span>
                            )}
                        </>
                    )}

                    {state.deploymentSpecType === "helm" && (
                        <>
                            <label htmlFor="chart-path-input" className={styles.label}>
                                Chart path *
                            </label>
                            <VSCodeTextField
                                id="chart-path-input"
                                value={
                                    isValid(state.helmParamsState.chartPath)
                                        ? `.${state.workspaceConfig.pathSeparator}${state.helmParamsState.chartPath.value} `
                                        : ""
                                }
                                readOnly
                                className={styles.control}
                            />
                            <div className={styles.controlSupplement}>
                                <VSCodeButton appearance="icon" onClick={handleChooseHelmChartFolderClick}>
                                    <span className={styles.iconButton}>
                                        <FontAwesomeIcon icon={faFolder} />
                                        &nbsp;Choose Helm chart folder
                                    </span>
                                </VSCodeButton>
                            </div>
                            {hasMessage(state.helmParamsState.chartPath) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.helmParamsState.chartPath.message}
                                </span>
                            )}

                            <label htmlFor="values-path-input" className={styles.label}>
                                Values.yaml path *
                            </label>
                            <VSCodeTextField
                                id="values-path-input"
                                value={
                                    isValid(state.helmParamsState.valuesYamlPath)
                                        ? `.${state.workspaceConfig.pathSeparator}${state.helmParamsState.valuesYamlPath.value}`
                                        : ""
                                }
                                readOnly
                                className={styles.control}
                            />
                            <div className={styles.controlSupplement}>
                                <VSCodeButton appearance="icon" onClick={handleChooseHelmValuesFileClick}>
                                    <span className={styles.iconButton}>
                                        <FontAwesomeIcon icon={faFolder} />
                                        &nbsp;Choose values.yaml file
                                    </span>
                                </VSCodeButton>
                            </div>
                            {hasMessage(state.helmParamsState.valuesYamlPath) && (
                                <span className={styles.validationMessage}>
                                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                    {state.helmParamsState.valuesYamlPath.message}
                                </span>
                            )}

                            <label className={styles.label}>Overrides</label>
                            {state.helmParamsState.overrides.map((o, i) => (
                                <>
                                    <div key={i} className={styles.control} style={{ display: "flex" }}>
                                        <VSCodeTextField
                                            id={`override-key-input-${i}`}
                                            className={`${styles.longControl} ${styles.validatable}`}
                                            onBlur={(e) => handleOverrideKeyChange(e, o)}
                                            onInput={(e) => handleOverrideKeyChange(e, o)}
                                            value={orDefault(o.key, "")}
                                        />
                                        =
                                        <VSCodeTextField
                                            id={`override-value-input-${i}`}
                                            className={`${styles.longControl} ${styles.validatable}`}
                                            onBlur={(e) => handleOverrideValueChange(e, o)}
                                            onInput={(e) => handleOverrideValueChange(e, o)}
                                            value={orDefault(o.value, "")}
                                        />
                                        <VSCodeButton appearance="icon" onClick={() => handleDeleteOverrideClick(o)}>
                                            <span className={styles.iconButton}>
                                                <FontAwesomeIcon icon={faTrash} />
                                            </span>
                                        </VSCodeButton>
                                    </div>
                                    {hasMessage(o.key) && (
                                        <span className={styles.validationMessage}>
                                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                            {o.key.message}
                                        </span>
                                    )}
                                    {hasMessage(o.value) && (
                                        <span className={styles.validationMessage}>
                                            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                            {o.value.message}
                                        </span>
                                    )}
                                </>
                            ))}
                            <div
                                className={
                                    state.helmParamsState.overrides.length === 0
                                        ? styles.control
                                        : styles.controlSupplement
                                }
                            >
                                <VSCodeButton appearance="icon" onClick={handleAddHelmOverrideClick}>
                                    <span className={styles.iconButton}>
                                        <FontAwesomeIcon icon={faPlus} />
                                        &nbsp;Add override
                                    </span>
                                </VSCodeButton>
                            </div>
                        </>
                    )}
                </fieldset>

                <div className={styles.buttonContainer}>
                    {state.status !== "Created" && (
                        <VSCodeButton type="submit" disabled={state.status !== "Editing" || isNothing(validate())}>
                            Create
                        </VSCodeButton>
                    )}

                    {existingFile && (
                        <VSCodeButton appearance="secondary" onClick={() => vscode.postOpenFileRequest(existingFile)}>
                            Open Workflow File
                        </VSCodeButton>
                    )}
                </div>
            </form>
        </>
    );
}

type LocalData = {
    lazyBranchNames: Lazy<string[]>;
    lazySubscriptions: Lazy<Subscription[]>;
    lazyClusterResourceGroups: Lazy<string[]>;
    lazyClusterNames: Lazy<string[]>;
    lazyNamespaces: Lazy<string[]>;
    lazyAcrResourceGroups: Lazy<string[]>;
    lazyAcrNames: Lazy<string[]>;
    lazyRepositoryNames: Lazy<string[]>;
};

function prepareData(state: DraftWorkflowState, updates: EventHandlerFunc[]): LocalData {
    const lazyClusters = ensureClustersLoaded(state.azureReferenceData, toNullable(state.subscription), updates);
    const lazyClusterResourceGroups = lazyMap(lazyClusters, (clusters) =>
        distinct(clusters.map((c) => c.resourceGroup)),
    );
    const clusterResourceGroup = toNullable(state.clusterResourceGroup);
    const lazyClusterNames = lazyMap(lazyClusters, (clusters) =>
        clusters.filter((c) => c.resourceGroup === clusterResourceGroup).map((c) => c.clusterName),
    );

    const lazyAcrs = ensureAcrsLoaded(state.azureReferenceData, toNullable(state.subscription), updates);
    const acrResourceGroup = toNullable(state.acrResourceGroup);
    const lazyAcrResourceGroups = lazyMap(lazyAcrs, (acrs) => distinct(acrs.map((a) => a.resourceGroup)));
    const lazyAcrNames = lazyMap(lazyAcrs, (acrs) =>
        acrs.filter((a) => a.resourceGroup === acrResourceGroup).map((a) => a.acrName),
    );
    return {
        lazyBranchNames: ensureForkBranchNamesLoaded(state.gitHubReferenceData, toNullable(state.fork), updates),
        lazySubscriptions: ensureSubscriptionsLoaded(state.azureReferenceData, updates),
        lazyClusterResourceGroups,
        lazyClusterNames,
        lazyNamespaces: ensureClusterNamespacesLoaded(
            state.azureReferenceData,
            toNullable(state.subscription),
            toNullable(state.clusterResourceGroup),
            toNullable(state.cluster),
            updates,
        ),
        lazyAcrResourceGroups,
        lazyAcrNames,
        lazyRepositoryNames: ensureAcrRepositoryNamesLoaded(
            state.azureReferenceData,
            toNullable(state.subscription),
            toNullable(state.acrResourceGroup),
            toNullable(state.acr),
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
