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
import { newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { Validatable, isValueSet, unset, valid } from "../../utilities/validation";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { AzureReferenceData, GitHubReferenceData, GitHubRepositoryReferenceData } from "../state/stateTypes";
import * as AzureReferenceDataUpdate from "../state/update/azureReferenceDataUpdate";
import * as GitHubReferenceDataUpdate from "../state/update/gitHubReferenceDataUpdate";

export type EventDef = {
    setBranchesLoading: GitHubRepoKey;
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setRepositoriesLoading: AcrKey;
    setClustersLoading: SubscriptionKey;
    setNamespacesLoading: ClusterKey;
    setWorkflowName: Validatable<string>;
    setGitHubRepo: Validatable<GitHubRepo>;
    setBranchName: Validatable<string>;
    setSubscription: Validatable<Subscription>;
    setAcrResourceGroup: Validatable<string>;
    setAcr: Validatable<string>;
    setRepositoryName: Validatable<NewOrExisting<string>>;
    setNewRepositoryName: string;
    setClusterResourceGroup: Validatable<string>;
    setCluster: Validatable<string>;
    setNamespace: Validatable<NewOrExisting<string>>;
    setNewNamespace: string;
    setDeploymentSpecType: DeploymentSpecType;
    setManifestPaths: Validatable<string[]>;
    setHelmOverrides: HelmOverrideState[];
    setCreating: void;
};

export type DraftWorkflowState = {
    pendingSelection: InitialSelection;
    workspaceConfig: WorkspaceFolderConfig;
    existingWorkflowFiles: ExistingFile[];
    status: Status;
    existingFile: string | null;
    azureReferenceData: AzureReferenceData;
    gitHubReferenceData: GitHubReferenceData;
    workflowName: Validatable<string>;
    gitHubRepo: Validatable<GitHubRepo>;
    branchName: Validatable<string>;
    dockerfilePath: Validatable<string>;
    buildContextPath: string;
    subscription: Validatable<Subscription>;
    acrResourceGroup: Validatable<string>;
    acr: Validatable<string>;
    repositoryName: Validatable<NewOrExisting<string>>;
    newRepositoryName: string | null;
    clusterResourceGroup: Validatable<string>;
    cluster: Validatable<string>;
    namespace: Validatable<NewOrExisting<string>>;
    newNamespace: string | null;
    deploymentSpecType: DeploymentSpecType;
    helmParamsState: HelmParamsState;
    manifestsParamsState: ManifestsParamsState;
};

export type HelmParamsState = {
    deploymentType: "helm";
    chartPath: Validatable<string>;
    valuesYamlPath: Validatable<string>;
    overrides: HelmOverrideState[];
};

export type HelmOverrideState = {
    key: Validatable<string>;
    value: Validatable<string>;
};

export type ManifestsParamsState = {
    deploymentType: "manifests";
    manifestPaths: Validatable<string[]>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftWorkflow", EventDef, DraftWorkflowState> = {
    createState: (initialState) => ({
        pendingSelection: {
            ...initialState.initialSelection,
            dockerfilePath: undefined,
            dockerfileBuildContextPath: undefined,
            deploymentSpecType: undefined,
            helmChartPath: undefined,
            helmValuesYamlPath: undefined,
            manifestFilePaths: undefined,
        },
        workspaceConfig: initialState.workspaceConfig,
        existingWorkflowFiles: initialState.existingWorkflowFiles,
        status: "Editing",
        existingFile: null,
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },
        gitHubReferenceData: {
            repositories: initialState.repos.map<GitHubRepositoryReferenceData>((repo) => ({
                repository: repo,
                branches: newNotLoaded(),
            })),
        },
        workflowName: unset(),
        gitHubRepo: unset(),
        branchName: unset(),
        dockerfilePath:
            initialState.initialSelection.dockerfilePath !== undefined
                ? valid(initialState.initialSelection.dockerfilePath)
                : unset(),
        buildContextPath: initialState.initialSelection.dockerfileBuildContextPath || "",
        subscription: unset(),
        clusterResourceGroup: unset(),
        cluster: unset(),
        namespace: unset(),
        newNamespace: null,
        acrResourceGroup: unset(),
        acr: unset(),
        repositoryName: unset(),
        newRepositoryName: null,
        deploymentSpecType: initialState.initialSelection.deploymentSpecType || "manifests",
        helmParamsState: {
            deploymentType: "helm",
            chartPath:
                initialState.initialSelection.helmChartPath !== undefined
                    ? valid(initialState.initialSelection.helmChartPath)
                    : unset(),
            valuesYamlPath:
                initialState.initialSelection.helmValuesYamlPath !== undefined
                    ? valid(initialState.initialSelection.helmValuesYamlPath)
                    : unset(),
            overrides: [],
        },
        manifestsParamsState: {
            deploymentType: "manifests",
            manifestPaths:
                initialState.initialSelection.manifestFilePaths !== undefined
                    ? valid(initialState.initialSelection.manifestFilePaths)
                    : unset(),
        },
    }),
    vscodeMessageHandler: {
        pickFilesResponse: (state, args) => updatePickedFile(state, args.identifier, args.paths),
        getBranchesResponse: (state, args) => ({
            ...state,
            branchName: getSelectedBranch(state, args, args.branches),
            gitHubReferenceData: GitHubReferenceDataUpdate.updateBranches(
                state.gitHubReferenceData,
                args,
                args.branches,
            ),
        }),
        getSubscriptionsResponse: (state, subs) => ({
            ...state,
            subscription: getSelectedValidatableValue(subs, (s) => s.id === state.pendingSelection.subscriptionId),
            azureReferenceData: AzureReferenceDataUpdate.updateSubscriptions(state.azureReferenceData, subs),
        }),
        getAcrsResponse: (state, args) => ({
            ...state,
            acrResourceGroup: getSelectedValidatableValue(
                args.acrKeys.map((acr) => acr.resourceGroup),
                (rg) => rg === state.pendingSelection.acrResourceGroup,
            ),
            acr: getSelectedValidatableValue(
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
            repositoryName: getSelectedValidatableValue(
                args.repositoryNames.map((name) => ({ isNew: false, value: name })),
                (repo) => repo.value === state.pendingSelection.acrRepository,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRepositoryNames(
                state.azureReferenceData,
                args,
                args.repositoryNames,
            ),
        }),
        getClustersResponse: (state, args) => ({
            ...state,
            clusterResourceGroup: getSelectedValidatableValue(
                args.clusterKeys.map((c) => c.resourceGroup),
                (rg) => rg === state.pendingSelection.clusterResourceGroup,
            ),
            cluster: getSelectedValidatableValue(
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
            namespace: getSelectedValidatableValue(
                args.namespaceNames.map((name) => ({ isNew: false, value: name })),
                (ns) => ns.value === state.pendingSelection.clusterNamespace,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateClusterNamespaces(
                state.azureReferenceData,
                args,
                args.namespaceNames,
            ),
        }),
        createWorkflowResponse: (state, existingFile) => ({
            ...state,
            status: "Created",
            existingFile: existingFile.path,
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
        setWorkflowName: (state, name) => ({
            ...state,
            workflowName: name,
            existingFile: getExistingFile(state, name),
        }),
        setGitHubRepo: (state, repo) => ({ ...state, gitHubRepo: repo }),
        setSubscription: (state, subscription) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, subscriptionId: undefined },
            subscription,
            acrResourceGroup: unset(),
            acr: unset(),
            repositoryName: unset(),
            clusterResourceGroup: unset(),
            cluster: unset(),
            namespace: unset(),
        }),
        setBranchName: (state, branch) => ({ ...state, branchName: branch }),
        setAcrResourceGroup: (state, acrResourceGroup) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrResourceGroup: undefined },
            acrResourceGroup,
            acr: unset(),
            repositoryName: unset(),
        }),
        setAcr: (state, acr) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrName: undefined },
            acr,
            repositoryName: unset(),
        }),
        setRepositoryName: (state, repository) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrRepository: undefined },
            repositoryName: repository,
        }),
        setNewRepositoryName: (state, name) => ({
            ...state,
            newRepositoryName: name,
            repositoryName: valid({ isNew: true, value: name }),
        }),
        setClusterResourceGroup: (state, clusterResourceGroup) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterResourceGroup: undefined },
            clusterResourceGroup,
            cluster: unset(),
            namespace: unset(),
        }),
        setCluster: (state, cluster) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterName: undefined },
            cluster,
            namespace: unset(),
        }),
        setNamespace: (state, namespace) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterNamespace: undefined },
            namespace,
        }),
        setNewNamespace: (state, name) => ({
            ...state,
            newNamespace: name,
            namespace: valid({ isNew: true, value: name }),
        }),
        setDeploymentSpecType: (state, type) => ({ ...state, deploymentSpecType: type }),
        setManifestPaths: (state, paths) => ({
            ...state,
            manifestsParamsState: { ...state.manifestsParamsState, manifestPaths: paths },
        }),
        setHelmOverrides: (state, overrides) => ({
            ...state,
            helmParamsState: { ...state.helmParamsState, overrides },
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
});

function updatePickedFile(
    state: DraftWorkflowState,
    identifier: PickFilesIdentifier,
    paths: [string, ...string[]],
): DraftWorkflowState {
    switch (identifier) {
        case "Dockerfile":
            return { ...state, dockerfilePath: valid(paths[0]) };
        case "BuildContext":
            return { ...state, buildContextPath: paths[0] };
        case "Manifests":
            return { ...state, manifestsParamsState: { ...state.manifestsParamsState, manifestPaths: valid(paths) } };
        case "HelmCharts":
            return { ...state, helmParamsState: { ...state.helmParamsState, chartPath: valid(paths[0]) } };
        case "HelmValuesYaml":
            return { ...state, helmParamsState: { ...state.helmParamsState, valuesYamlPath: valid(paths[0]) } };
        default:
            throw new Error(`Unknown file identifier: ${identifier}`);
    }
}

function getSelectedValidatableValue<TItem>(
    items: TItem[],
    matchesInitialValue: (item: TItem) => boolean,
): Validatable<TItem> {
    const initialItem = items.find(matchesInitialValue);
    if (initialItem) {
        return valid(initialItem);
    }

    return unset();
}

function getSelectedBranch(state: DraftWorkflowState, key: GitHubRepoKey, branches: string[]): Validatable<string> {
    if (
        !isValueSet(state.gitHubRepo) ||
        key.gitHubRepoOwner !== state.gitHubRepo.value.gitHubRepoOwner ||
        key.gitHubRepoName !== state.gitHubRepo.value.gitHubRepoName
    ) {
        return unset();
    }

    const defaultBranch = state.gitHubRepo.value.defaultBranch;
    if (!branches.includes(defaultBranch)) {
        return unset();
    }

    return valid(defaultBranch);
}

function getExistingFile(state: DraftWorkflowState, workflowName: Validatable<string>): string | null {
    if (!isValueSet(workflowName)) {
        return null;
    }

    const file = state.existingWorkflowFiles.find((f) => f.name === workflowName.value);
    return file ? file.path : null;
}
