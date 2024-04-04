import {
    ExistingFile,
    PickFilesIdentifier,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    ForkInfo,
    ForkKey,
    NewOrExisting,
    Subscription,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { getDialogEventHandler } from "../../utilities/dialogState";
import { newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { Validatable, isValueSet, unset, valid } from "../../utilities/validation";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { DraftDialogEventDef, DraftStateWithDialogsState, initialDraftDialogState } from "../dialogs/dialogState";
import { AzureReferenceData, GitHubReferenceData } from "../state/stateTypes";
import * as AzureReferenceDataUpdate from "../state/update/azureReferenceDataUpdate";
import * as GitHubReferenceDataUpdate from "../state/update/gitHubReferenceDataUpdate";

export type EventDef = DraftDialogEventDef & {
    setBranchesLoading: ForkKey;
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setRepositoriesLoading: AcrKey;
    setClustersLoading: SubscriptionKey;
    setNamespacesLoading: ClusterKey;
    setWorkflowName: Validatable<string>;
    setFork: Validatable<ForkInfo>;
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
    setHelmOverrides: HelmOverrideState[];
    setCreating: void;
};

export type DraftWorkflowState = DraftStateWithDialogsState & {
    workspaceConfig: WorkspaceFolderConfig;
    existingWorkflowFiles: ExistingFile[];
    status: Status;
    existingFile: string | null;
    azureReferenceData: AzureReferenceData;
    gitHubReferenceData: GitHubReferenceData;
    workflowName: Validatable<string>;
    fork: Validatable<ForkInfo>;
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
        workspaceConfig: initialState.workspaceConfig,
        existingWorkflowFiles: initialState.existingWorkflowFiles,
        status: "Editing",
        existingFile: null,
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },
        gitHubReferenceData: {
            forks: initialState.forks.map((f) => ({
                fork: f,
                branches: newNotLoaded(),
            })),
        },
        workflowName: unset(),
        fork: unset(),
        branchName: unset(),
        dockerfilePath: unset(),
        buildContextPath: "",
        subscription: unset(),
        clusterResourceGroup: unset(),
        cluster: unset(),
        namespace: unset(),
        newNamespace: null,
        acrResourceGroup: unset(),
        acr: unset(),
        repositoryName: unset(),
        newRepositoryName: null,
        deploymentSpecType: "manifests",
        helmParamsState: {
            deploymentType: "helm",
            chartPath: unset(),
            valuesYamlPath: unset(),
            overrides: [],
        },
        manifestsParamsState: {
            deploymentType: "manifests",
            manifestPaths: unset(),
        },
        ...initialDraftDialogState,
    }),
    vscodeMessageHandler: {
        pickFilesResponse: (state, args) => updatePickedFile(state, args.identifier, args.paths),
        getBranchesResponse: (state, args) => ({
            ...state,
            branchName: getDefaultBranch(state, args.forkName, args.branches),
            gitHubReferenceData: GitHubReferenceDataUpdate.updateForkBranches(
                state.gitHubReferenceData,
                args.forkName,
                args.branches,
            ),
        }),
        getSubscriptionsResponse: (state, subs) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateSubscriptions(state.azureReferenceData, subs),
        }),
        getAcrsResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrNames(
                state.azureReferenceData,
                args.subscriptionId,
                args.acrKeys,
            ),
        }),
        getRepositoriesResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRepositoryNames(
                state.azureReferenceData,
                args,
                args.repositoryNames,
            ),
        }),
        getClustersResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateClusterNames(
                state.azureReferenceData,
                args.subscriptionId,
                args.clusterKeys,
            ),
        }),
        getNamespacesResponse: (state, args) => ({
            ...state,
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
            gitHubReferenceData: GitHubReferenceDataUpdate.setForkBranchesLoading(
                state.gitHubReferenceData,
                args.forkName,
            ),
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
        setFork: (state, fork) => ({ ...state, fork }),
        setSubscription: (state, subscription) => ({
            ...state,
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
            acrResourceGroup,
            acr: unset(),
            repositoryName: unset(),
        }),
        setAcr: (state, acr) => ({ ...state, acr, repositoryName: unset() }),
        setRepositoryName: (state, repository) => ({ ...state, repositoryName: repository }),
        setNewRepositoryName: (state, name) => ({
            ...state,
            newRepositoryName: name,
            repositoryName: valid({ isNew: true, value: name }),
        }),
        setClusterResourceGroup: (state, clusterResourceGroup) => ({
            ...state,
            clusterResourceGroup,
            cluster: unset(),
            namespace: unset(),
        }),
        setCluster: (state, cluster) => ({ ...state, cluster, namespace: unset() }),
        setNamespace: (state, namespace) => ({ ...state, namespace }),
        setNewNamespace: (state, name) => ({
            ...state,
            newNamespace: name,
            namespace: valid({ isNew: true, value: name }),
        }),
        setDeploymentSpecType: (state, type) => ({ ...state, deploymentSpecType: type }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
        setHelmOverrides: (state, overrides) => ({
            ...state,
            helmParamsState: { ...state.helmParamsState, overrides },
        }),
        ...getDialogEventHandler(),
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

function getDefaultBranch(state: DraftWorkflowState, forkName: string, branches: string[]): Validatable<string> {
    if (!isValueSet(state.fork) || forkName !== state.fork.value.name) {
        return unset();
    }

    const fork = state.fork.value;
    const defaultBranch = branches.find((b) => b === fork.defaultBranch);
    if (!defaultBranch) {
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
