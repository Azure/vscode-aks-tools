import {
    ExistingFile,
    InitialSelection,
    PickFilesIdentifier,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    GitHubRepo,
    GitHubRepoKey,
    NewOrExisting,
    Subscription,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { isLoaded, newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { Validatable, isValid, unset, valid } from "../../utilities/validation";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { AzureReferenceData, GitHubReferenceData, GitHubRepositoryReferenceData } from "../state/stateTypes";
import * as AzureReferenceDataUpdate from "../state/update/azureReferenceDataUpdate";
import * as GitHubReferenceDataUpdate from "../state/update/gitHubReferenceDataUpdate";

export type EventDef = {
    // Reference data loading
    setBranchesLoading: GitHubRepoKey;
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setRepositoriesLoading: AcrKey;
    setClustersLoading: SubscriptionKey;
    setNamespacesLoading: ClusterKey;

    // Setting selected values
    setSelectedWorkflowName: Validatable<string>;
    setSelectedGitHubRepo: Validatable<GitHubRepo>;
    setSelectedBranchName: Validatable<string>;
    setSelectedSubscription: Validatable<Subscription>;
    setSelectedAcrResourceGroup: Validatable<string>;
    setSelectedAcr: Validatable<string>;
    setSelectedRepositoryName: Validatable<NewOrExisting<string>>;
    setSelectedClusterResourceGroup: Validatable<string>;
    setSelectedCluster: Validatable<string>;
    setSelectedClusterNamespace: Validatable<NewOrExisting<string>>;
    setSelectedDeploymentSpecType: DeploymentSpecType;
    setSelectedManifestPaths: Validatable<string[]>;
    setSelectedHelmOverrides: HelmOverrideState[];

    // Updating status
    setCreating: void;
};

export type DraftWorkflowState = {
    // Overall status
    status: Status;

    // Reference data
    workspaceConfig: WorkspaceFolderConfig;
    azureReferenceData: AzureReferenceData;
    gitHubReferenceData: GitHubReferenceData;

    // Properties waiting to be automatically selected when data is available
    pendingSelection: InitialSelection;

    // Selected items
    selectedWorkflowName: Validatable<string>;
    selectedGitHubRepo: Validatable<GitHubRepo>;
    selectedBranchName: Validatable<string>;
    selectedDockerfilePath: Validatable<string>;
    selectedBuildContextPath: string;
    selectedSubscription: Validatable<Subscription>;
    selectedAcrResourceGroup: Validatable<string>;
    selectedAcr: Validatable<string>;
    selectedRepositoryName: Validatable<NewOrExisting<string>>;
    selectedClusterResourceGroup: Validatable<string>;
    selectedCluster: Validatable<string>;
    selectedClusterNamespace: Validatable<NewOrExisting<string>>;
    selectedDeploymentSpecType: DeploymentSpecType;

    // State that's specific to the selected deployment type
    helmParamsState: HelmParamsState;
    manifestsParamsState: ManifestsParamsState;

    // Workflow files that already exist in the selected location
    existingWorkflowFiles: ExistingFile[];
};

export type HelmParamsState = {
    deploymentType: "helm";
    selectedChartPath: Validatable<string>;
    selectedValuesYamlPath: Validatable<string>;
    selectedOverrides: HelmOverrideState[];
};

export type HelmOverrideState = {
    key: Validatable<string>;
    value: Validatable<string>;
};

export type ManifestsParamsState = {
    deploymentType: "manifests";
    selectedManifestPaths: Validatable<string[]>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftWorkflow", EventDef, DraftWorkflowState> = {
    createState: (initialState) => ({
        status: "Editing",

        // Reference data
        workspaceConfig: initialState.workspaceConfig,
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },
        gitHubReferenceData: {
            repositories: initialState.repos.map<GitHubRepositoryReferenceData>((repo) => ({
                repository: repo,
                branches: newNotLoaded(),
            })),
        },

        // Pending selections (remove those we can select immediately)
        pendingSelection: {
            ...initialState.initialSelection,
            dockerfilePath: undefined,
            dockerfileBuildContextPath: undefined,
            deploymentSpecType: undefined,
            helmChartPath: undefined,
            helmValuesYamlPath: undefined,
            manifestFilePaths: undefined,
        },

        // Selected items
        selectedWorkflowName: unset(),
        selectedGitHubRepo: unset(),
        selectedBranchName: unset(),
        selectedDockerfilePath:
            initialState.initialSelection.dockerfilePath !== undefined
                ? valid(initialState.initialSelection.dockerfilePath)
                : unset(),
        selectedBuildContextPath: initialState.initialSelection.dockerfileBuildContextPath || "",
        selectedSubscription: unset(),
        selectedClusterResourceGroup: unset(),
        selectedCluster: unset(),
        selectedClusterNamespace:
            initialState.initialSelection.clusterNamespace !== undefined
                ? // As far as we know at this stage, the initial selection is 'new'.
                  // If it turns out to be 'existing', we'll update this value when we get the namespaces.
                  valid({ isNew: true, value: initialState.initialSelection.clusterNamespace })
                : unset(),
        selectedAcrResourceGroup: unset(),
        selectedAcr: unset(),
        selectedRepositoryName:
            initialState.initialSelection.acrRepository !== undefined
                ? valid({ isNew: true, value: initialState.initialSelection.acrRepository })
                : unset(),
        selectedDeploymentSpecType: initialState.initialSelection.deploymentSpecType || "manifests",
        helmParamsState: {
            deploymentType: "helm",
            selectedChartPath:
                initialState.initialSelection.helmChartPath !== undefined
                    ? valid(initialState.initialSelection.helmChartPath)
                    : unset(),
            selectedValuesYamlPath:
                initialState.initialSelection.helmValuesYamlPath !== undefined
                    ? valid(initialState.initialSelection.helmValuesYamlPath)
                    : unset(),
            selectedOverrides: [],
        },
        manifestsParamsState: {
            deploymentType: "manifests",
            selectedManifestPaths:
                initialState.initialSelection.manifestFilePaths !== undefined
                    ? valid(initialState.initialSelection.manifestFilePaths)
                    : unset(),
        },

        // Populate existing files from initial state
        existingWorkflowFiles: initialState.existingWorkflowFiles,
    }),
    vscodeMessageHandler: {
        pickFilesResponse: (state, args) => updatePickedFile(state, args.identifier, args.paths),
        getBranchesResponse: (state, args) => ({
            ...state,
            selectedBranchName: getSelectedBranch(state.selectedGitHubRepo, args, args.branches),
            gitHubReferenceData: GitHubReferenceDataUpdate.updateBranches(
                state.gitHubReferenceData,
                args,
                args.branches,
            ),
        }),
        getSubscriptionsResponse: (state, subs) => ({
            ...state,
            selectedSubscription: getSelectedValidatableValue(
                subs,
                (s) => s.id === state.pendingSelection.subscriptionId,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateSubscriptions(state.azureReferenceData, subs),
        }),
        getAcrsResponse: (state, args) => ({
            ...state,
            selectedAcrResourceGroup: getSelectedValidatableValue(
                args.acrKeys.map((acr) => acr.resourceGroup),
                (rg) => rg === state.pendingSelection.acrResourceGroup,
            ),
            selectedAcr: getSelectedValidatableValue(
                args.acrKeys.map((acr) => acr.acrName),
                (acr) => acr === state.pendingSelection.acrName,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateAcrNames(
                state.azureReferenceData,
                args.subscriptionId,
                args.acrKeys,
            ),
        }),
        getRepositoriesResponse: (state, args) => ({
            ...state,
            selectedRepositoryName: getSelectedValidatableValue(
                args.repositoryNames.map((name) => ({ isNew: false, value: name })),
                (repo) => repo.value === state.pendingSelection.acrRepository,
                state.selectedRepositoryName,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRepositoryNames(
                state.azureReferenceData,
                args,
                args.repositoryNames,
            ),
        }),
        getClustersResponse: (state, args) => ({
            ...state,
            selectedClusterResourceGroup: getSelectedValidatableValue(
                args.clusterKeys.map((c) => c.resourceGroup),
                (rg) => rg === state.pendingSelection.clusterResourceGroup,
            ),
            selectedCluster: getSelectedValidatableValue(
                args.clusterKeys.map((c) => c.clusterName),
                (c) => c === state.pendingSelection.clusterName,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateClusterNames(
                state.azureReferenceData,
                args.subscriptionId,
                args.clusterKeys,
            ),
        }),
        getNamespacesResponse: (state, args) => ({
            ...state,
            selectedClusterNamespace: getSelectedValidatableValue(
                args.namespaceNames.map((name) => ({ isNew: false, value: name })),
                (ns) => ns.value === state.pendingSelection.clusterNamespace,
                state.selectedClusterNamespace,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateClusterNamespaces(
                state.azureReferenceData,
                args,
                args.namespaceNames,
            ),
        }),
        createWorkflowResponse: (state, existingFiles) => ({
            ...state,
            status: "Created",
            existingWorkflowFiles: existingFiles,
        }),
    },
    eventHandler: {
        setBranchesLoading: (state, args) => ({
            ...state,
            gitHubReferenceData: GitHubReferenceDataUpdate.setBranchesLoading(state.gitHubReferenceData, args),
        }),
        setSubscriptionsLoading: (state) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setSubscriptionsLoading(state.azureReferenceData),
        }),
        setAcrsLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setAcrsLoading(state.azureReferenceData, args.subscriptionId),
        }),
        setRepositoriesLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setAcrRepositoriesLoading(state.azureReferenceData, args),
        }),
        setClustersLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setClustersLoading(
                state.azureReferenceData,
                args.subscriptionId,
            ),
        }),
        setNamespacesLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setClusterNamespacesLoading(state.azureReferenceData, args),
        }),
        setSelectedWorkflowName: (state, name) => ({
            ...state,
            selectedWorkflowName: name,
        }),
        setSelectedGitHubRepo: (state, repo) => ({
            ...state,
            selectedGitHubRepo: repo,
            selectedBranchName: isValid(repo)
                ? getSelectedBranch(repo, repo.value, getKnownBranches(state, repo.value))
                : unset(),
        }),
        setSelectedSubscription: (state, sub) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, subscriptionId: undefined },
            selectedSubscription: sub,
            selectedAcrResourceGroup: unset(),
            selectedAcr: unset(),
            selectedRepositoryName: unset(),
            selectedClusterResourceGroup: unset(),
            selectedCluster: unset(),
            selectedClusterNamespace: unset(),
        }),
        setSelectedBranchName: (state, branch) => ({ ...state, selectedBranchName: branch }),
        setSelectedAcrResourceGroup: (state, rg) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrResourceGroup: undefined },
            selectedAcrResourceGroup: rg,
            selectedAcr: unset(),
            selectedRepositoryName: unset(),
        }),
        setSelectedAcr: (state, acr) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrName: undefined },
            selectedAcr: acr,
            selectedRepositoryName: unset(),
        }),
        setSelectedRepositoryName: (state, repository) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrRepository: undefined },
            selectedRepositoryName: repository,
        }),
        setSelectedClusterResourceGroup: (state, rg) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterResourceGroup: undefined },
            selectedClusterResourceGroup: rg,
            selectedCluster: unset(),
            selectedClusterNamespace: unset(),
        }),
        setSelectedCluster: (state, cluster) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterName: undefined },
            selectedCluster: cluster,
            selectedClusterNamespace: unset(),
        }),
        setSelectedClusterNamespace: (state, ns) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterNamespace: undefined },
            selectedClusterNamespace: ns,
        }),
        setSelectedDeploymentSpecType: (state, type) => ({ ...state, selectedDeploymentSpecType: type }),
        setSelectedManifestPaths: (state, paths) => ({
            ...state,
            manifestsParamsState: { ...state.manifestsParamsState, selectedManifestPaths: paths },
        }),
        setSelectedHelmOverrides: (state, overrides) => ({
            ...state,
            helmParamsState: { ...state.helmParamsState, selectedOverrides: overrides },
        }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
    },
};

export const vscode = getWebviewMessageContext<"draftWorkflow">({
    pickFilesRequest: null,
    getBranchesRequest: null,
    getSubscriptionsRequest: null,
    getAcrsRequest: null,
    getRepositoriesRequest: null,
    getClustersRequest: null,
    getNamespacesRequest: null,
    createWorkflowRequest: null,
    openFileRequest: null,
    launchDraftDockerfile: null,
    launchDraftDeployment: null,
    launchConnectAcrToCluster: null,
});

function updatePickedFile(
    state: DraftWorkflowState,
    identifier: PickFilesIdentifier,
    paths: [string, ...string[]],
): DraftWorkflowState {
    switch (identifier) {
        case "Dockerfile":
            return { ...state, selectedDockerfilePath: valid(paths[0]) };
        case "BuildContext":
            return { ...state, selectedBuildContextPath: paths[0] };
        case "Manifests":
            return {
                ...state,
                manifestsParamsState: { ...state.manifestsParamsState, selectedManifestPaths: valid(paths) },
            };
        case "HelmCharts":
            return { ...state, helmParamsState: { ...state.helmParamsState, selectedChartPath: valid(paths[0]) } };
        case "HelmValuesYaml":
            return { ...state, helmParamsState: { ...state.helmParamsState, selectedValuesYamlPath: valid(paths[0]) } };
        default:
            throw new Error(`Unknown file identifier: ${identifier}`);
    }
}

function getSelectedValidatableValue<TItem>(
    items: TItem[],
    matchesInitialValue: (item: TItem) => boolean,
    defaultValue: Validatable<TItem> = unset(),
): Validatable<TItem> {
    const initialItem = items.find(matchesInitialValue);
    if (initialItem) {
        return valid(initialItem);
    }

    return defaultValue;
}

function getKnownBranches(state: DraftWorkflowState, key: GitHubRepoKey): string[] {
    const repo = state.gitHubReferenceData.repositories.find(
        (r) =>
            r.repository.gitHubRepoOwner === key.gitHubRepoOwner && r.repository.gitHubRepoName === key.gitHubRepoName,
    );

    if (!repo || !isLoaded(repo.branches)) {
        return [];
    }

    return repo.branches.value;
}

function getSelectedBranch(
    selectedRepoValidatable: Validatable<GitHubRepo>,
    branchesRepo: GitHubRepoKey,
    branches: string[],
): Validatable<string> {
    if (!isValid(selectedRepoValidatable)) {
        return unset();
    }

    const selectedRepo = selectedRepoValidatable.value;
    if (
        branchesRepo.gitHubRepoOwner !== selectedRepo.gitHubRepoOwner ||
        branchesRepo.gitHubRepoName !== selectedRepo.gitHubRepoName
    ) {
        return unset();
    }

    const defaultBranch = selectedRepo.defaultBranch;
    if (!branches.includes(defaultBranch)) {
        return unset();
    }

    return valid(defaultBranch);
}
