import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    NewOrExisting,
    RepositoryKey,
    Subscription,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import {
    ExistingFiles,
    InitialSelection,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftDeployment";
import { newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { Validatable, ValidatableValue, invalid, unset, valid } from "../../utilities/validation";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { AzureReferenceData } from "../state/stateTypes";
import * as AzureReferenceDataUpdate from "../state/update/azureReferenceDataUpdate";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";

export type EventDef = {
    // Reference data loading
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setRepositoriesLoading: AcrKey;
    setRepoTagsLoading: RepositoryKey;
    setClustersLoading: SubscriptionKey;
    setClusterNamespacesLoading: ClusterKey;

    // Setting selected values
    setSelectedSubscription: Validatable<Subscription>;
    setSelectedAcrResourceGroup: Validatable<string>;
    setSelectedAcr: Validatable<string>;
    setSelectedAcrRepository: Validatable<NewOrExisting<string>>;
    setSelectedAcrRepoTag: Validatable<NewOrExisting<string>>;
    setSelectedClusterResourceGroup: string | null;
    setSelectedCluster: string | null;
    setSelectedClusterNamespace: Validatable<NewOrExisting<string>>;
    setSelectedApplicationName: Validatable<string>;
    setSelectedDeploymentSpecType: DeploymentSpecType;
    setSelectedTargetPort: Validatable<number>;
    setSelectedServicePort: Validatable<number>;

    // Updating status
    setCreating: void;
};

export type DraftDeploymentState = {
    // Overall status
    status: Status;

    // Reference data
    workspaceConfig: WorkspaceFolderConfig;
    azureReferenceData: AzureReferenceData;

    // Properties waiting to be automatically selected when data is available
    pendingSelection: InitialSelection;

    // Selected items
    selectedLocation: ValidatableValue<string>;
    selectedSubscription: Validatable<Subscription>;
    selectedAcrResourceGroup: Validatable<string>;
    selectedAcr: Validatable<string>;
    selectedAcrRepository: Validatable<NewOrExisting<string>>;
    selectedAcrRepoTag: Validatable<NewOrExisting<string>>;
    selectedClusterResourceGroup: string | null;
    selectedCluster: string | null;
    selectedClusterNamespace: Validatable<NewOrExisting<string>>;
    selectedApplicationName: Validatable<string>;
    selectedDeploymentSpecType: DeploymentSpecType;
    selectedTargetPort: Validatable<number>;
    selectedServicePort: Validatable<number>;

    // Deployment files that already exist in the selected location
    existingFiles: ExistingFiles;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftDeployment", EventDef, DraftDeploymentState> = {
    createState: (initialState) => ({
        status: "Editing",

        // Reference data
        workspaceConfig: initialState.workspaceConfig,
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },

        // Pending selections (remove those we can select immediately)
        pendingSelection: { ...initialState.initialSelection, targetPort: undefined },

        // Selected items
        selectedLocation: getValidatedLocation(initialState.location, "manifests", initialState.existingFiles),
        selectedSubscription: unset(),
        selectedClusterResourceGroup: null,
        selectedCluster: null,
        selectedClusterNamespace: unset(),
        selectedAcrResourceGroup: unset(),
        selectedAcr: unset(),
        selectedAcrRepository: unset(),
        selectedAcrRepoTag: unset(),
        selectedApplicationName: unset(),
        selectedDeploymentSpecType: "manifests",
        selectedTargetPort: valid(initialState.initialSelection.targetPort || 80),
        selectedServicePort: valid(80),

        // Populate existing files from initial state
        existingFiles: initialState.existingFiles,
    }),
    vscodeMessageHandler: {
        pickLocationResponse: (state, response) => ({
            ...state,
            existingFiles: response.existingFiles,
            selectedLocation: getValidatedLocation(
                response.location,
                state.selectedDeploymentSpecType,
                response.existingFiles,
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
        getRepoTagsResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRepoTags(state.azureReferenceData, args, args.tags),
        }),
        getClustersResponse: (state, args) => ({
            ...state,
            selectedClusterResourceGroup: getSelectedValue(
                args.clusterKeys.map((c) => c.resourceGroup),
                (rg) => rg === state.pendingSelection.clusterResourceGroup,
            ),
            selectedCluster: getSelectedValue(
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
            azureReferenceData: AzureReferenceDataUpdate.updateClusterNamespaces(
                state.azureReferenceData,
                args,
                args.namespaceNames,
            ),
        }),
        createDeploymentResponse: (state, existingFiles) => ({
            ...state,
            existingFiles,
            status: "Created",
        }),
    },
    eventHandler: {
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
        setRepoTagsLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setAcrRepoTagsLoading(state.azureReferenceData, args),
        }),
        setClustersLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setClustersLoading(
                state.azureReferenceData,
                args.subscriptionId,
            ),
        }),
        setClusterNamespacesLoading: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setClusterNamespacesLoading(state.azureReferenceData, args),
        }),
        setSelectedSubscription: (state, sub) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, subscriptionId: undefined },
            selectedSubscription: sub,
            selectedClusterResourceGroup: null,
            selectedCluster: null,
            selectedClusterNamespace: unset(),
            selectedAcrResourceGroup: unset(),
            selectedAcr: unset(),
            selectedAcrRepository: unset(),
            selectedAcrRepoTag: unset(),
        }),
        setSelectedClusterResourceGroup: (state, rg) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterResourceGroup: undefined },
            selectedClusterResourceGroup: rg,
            selectedCluster: null,
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
            selectedClusterNamespace: ns,
        }),
        setSelectedAcrResourceGroup: (state, rg) => ({
            ...state,
            selectedAcrResourceGroup: rg,
            selectedAcr: unset(),
            selectedAcrRepository: unset(),
            selectedAcrRepoTag: unset(),
        }),
        setSelectedAcr: (state, acr) => ({
            ...state,
            selectedAcr: acr,
            selectedAcrRepository: unset(),
            selectedAcrRepoTag: unset(),
        }),
        setSelectedAcrRepository: (state, repo) => ({
            ...state,
            selectedAcrRepository: repo,
            selectedAcrRepoTag: unset(),
        }),
        setSelectedAcrRepoTag: (state, tag) => ({
            ...state,
            selectedAcrRepoTag: tag,
        }),
        setSelectedApplicationName: (state, name) => ({
            ...state,
            selectedApplicationName: name,
        }),
        setSelectedDeploymentSpecType: (state, specType) => ({
            ...state,
            selectedDeploymentSpecType: specType,
            selectedLocation: getValidatedLocation(state.selectedLocation.value, specType, state.existingFiles),
        }),
        setSelectedTargetPort: (state, port) => ({
            ...state,
            selectedTargetPort: port,
        }),
        setSelectedServicePort: (state, port) => ({
            ...state,
            selectedServicePort: port,
        }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
    },
};

export const vscode = getWebviewMessageContext<"draftDeployment">({
    pickLocationRequest: null,
    getSubscriptionsRequest: null,
    getAcrsRequest: null,
    getRepositoriesRequest: null,
    getRepoTagsRequest: null,
    getClustersRequest: null,
    getNamespacesRequest: null,
    createDeploymentRequest: null,
    openFileRequest: null,
    launchDraftWorkflow: null,
});

function getValidatedLocation(
    location: string,
    type: DeploymentSpecType,
    existingFiles: ExistingFiles,
): ValidatableValue<string> {
    const existingPaths = getExistingPaths(type, existingFiles);
    return existingPaths.length === 0
        ? valid(location)
        : invalid(location, "At least one deployment file exists in the directory.");
}

function getSelectedValue<TItem>(items: TItem[], matchesInitialValue: (item: TItem) => boolean): TItem | null {
    const initialItem = items.find(matchesInitialValue);
    if (initialItem) {
        return initialItem;
    }

    return null;
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

export function getExistingPaths(type: DeploymentSpecType, existingFiles: ExistingFiles): string[] {
    switch (type) {
        case "helm":
            return existingFiles.helm;
        case "kustomize":
            return existingFiles.kustomize;
        case "manifests":
            return existingFiles.manifests;
    }
}
