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
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setRepositoriesLoading: AcrKey;
    setRepoTagsLoading: RepositoryKey;
    setClustersLoading: SubscriptionKey;
    setClusterNamespacesLoading: ClusterKey;
    setSubscription: Validatable<Subscription>;
    setAcrResourceGroup: Validatable<string>;
    setAcr: Validatable<string>;
    setNewAcrRepository: string;
    setAcrRepository: Validatable<NewOrExisting<string>>;
    setNewAcrRepoTag: string;
    setAcrRepoTag: Validatable<NewOrExisting<string>>;
    setClusterResourceGroup: string | null;
    setCluster: string | null;
    setNewClusterNamespace: string;
    setClusterNamespace: Validatable<NewOrExisting<string>>;
    setApplicationName: Validatable<string>;
    setDeploymentSpecType: DeploymentSpecType;
    setTargetPort: Validatable<number>;
    setServicePort: Validatable<number>;
    setCreating: void;
};

export type DraftDeploymentState = {
    pendingSelection: InitialSelection;
    workspaceConfig: WorkspaceFolderConfig;
    location: ValidatableValue<string>;
    existingFiles: ExistingFiles;
    status: Status;
    azureReferenceData: AzureReferenceData;
    subscription: Validatable<Subscription>;
    acrResourceGroup: Validatable<string>;
    acr: Validatable<string>;
    newAcrRepository: string | null;
    acrRepository: Validatable<NewOrExisting<string>>;
    newAcrRepoTag: string | null;
    acrRepoTag: Validatable<NewOrExisting<string>>;
    clusterResourceGroup: string | null;
    cluster: string | null;
    newClusterNamespace: string | null;
    clusterNamespace: Validatable<NewOrExisting<string>>;
    applicationName: Validatable<string>;
    deploymentSpecType: DeploymentSpecType;
    targetPort: Validatable<number>;
    servicePort: Validatable<number>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftDeployment", EventDef, DraftDeploymentState> = {
    createState: (initialState) => ({
        pendingSelection: { ...initialState.initialSelection, targetPort: undefined },
        workspaceConfig: initialState.workspaceConfig,
        location: getValidatedLocation(initialState.location, "manifests", initialState.existingFiles),
        existingFiles: initialState.existingFiles,
        status: "Editing",
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },
        subscription: unset(),
        clusterResourceGroup: null,
        cluster: null,
        newClusterNamespace: null,
        clusterNamespace: unset(),
        acrResourceGroup: unset(),
        acr: unset(),
        newAcrRepository: null,
        acrRepository: unset(),
        newAcrRepoTag: null,
        acrRepoTag: unset(),
        applicationName: unset(),
        deploymentSpecType: "manifests",
        targetPort: valid(initialState.initialSelection.targetPort || 80),
        servicePort: valid(80),
    }),
    vscodeMessageHandler: {
        pickLocationResponse: (state, response) => ({
            ...state,
            existingFiles: response.existingFiles,
            location: getValidatedLocation(response.location, state.deploymentSpecType, response.existingFiles),
        }),
        getSubscriptionsResponse: (state, subs) => ({
            ...state,
            subscription: getSelectedValidatableValue(subs, (s) => s.id === state.pendingSelection.subscriptionId),
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
            clusterResourceGroup: getSelectedValue(
                args.clusterKeys.map((c) => c.resourceGroup),
                (rg) => rg === state.pendingSelection.clusterResourceGroup,
            ),
            cluster: getSelectedValue(
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
        setSubscription: (state, subscription) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, subscriptionId: undefined },
            subscription,
            clusterResourceGroup: null,
            cluster: null,
            clusterNamespace: unset(),
            acrResourceGroup: unset(),
            acr: unset(),
            acrRepository: unset(),
            acrRepoTag: unset(),
        }),
        setClusterResourceGroup: (state, clusterResourceGroup) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterResourceGroup: undefined },
            clusterResourceGroup,
            cluster: null,
            clusterNamespace: unset(),
        }),
        setCluster: (state, cluster) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterName: undefined },
            cluster,
            clusterNamespace: unset(),
        }),
        setNewClusterNamespace: (state, newClusterNamespace) => ({
            ...state,
            newClusterNamespace,
            clusterNamespace: valid({ isNew: true, value: newClusterNamespace }),
        }),
        setClusterNamespace: (state, clusterNamespace) => ({
            ...state,
            clusterNamespace,
        }),
        setAcrResourceGroup: (state, acrResourceGroup) => ({
            ...state,
            acrResourceGroup,
            acr: unset(),
            acrRepository: unset(),
            acrRepoTag: unset(),
        }),
        setAcr: (state, acr) => ({
            ...state,
            acr,
            acrRepository: unset(),
            acrRepoTag: unset(),
        }),
        setNewAcrRepository: (state, newAcrRepository) => ({
            ...state,
            newAcrRepository,
            acrRepository: valid({ isNew: true, value: newAcrRepository }),
        }),
        setAcrRepository: (state, acrRepository) => ({
            ...state,
            acrRepository,
            acrRepoTag: unset(),
        }),
        setNewAcrRepoTag: (state, newAcrRepoTag) => ({
            ...state,
            newAcrRepoTag,
            acrRepoTag: valid({ isNew: true, value: newAcrRepoTag }),
        }),
        setAcrRepoTag: (state, acrRepoTag) => ({
            ...state,
            acrRepoTag,
        }),
        setApplicationName: (state, applicationName) => ({
            ...state,
            applicationName,
        }),
        setDeploymentSpecType: (state, deploymentSpecType) => ({
            ...state,
            deploymentSpecType,
            location: getValidatedLocation(state.location.value, deploymentSpecType, state.existingFiles),
        }),
        setTargetPort: (state, targetPort) => ({
            ...state,
            targetPort,
        }),
        setServicePort: (state, servicePort) => ({
            ...state,
            servicePort,
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