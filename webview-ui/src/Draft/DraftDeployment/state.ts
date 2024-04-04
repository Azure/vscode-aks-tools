import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    NewOrExisting,
    RepositoryKey,
    Subscription,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { ExistingFiles } from "../../../../src/webview-contract/webviewDefinitions/draft/draftDeployment";
import { newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { Validatable, ValidatableValue, invalid, unset, valid } from "../../utilities/validation";
import { getWebviewMessageContext } from "../../utilities/vscode";
import { AzureReferenceData } from "../state/stateTypes";
import * as AzureReferenceDataUpdate from "../state/update/azureReferenceDataUpdate";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { DraftDialogEventDef, DraftStateWithDialogsState, initialDraftDialogState } from "../dialogs/dialogState";
import { getDialogEventHandler } from "../../utilities/dialogState";

export type EventDef = DraftDialogEventDef & {
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
    setPort: Validatable<number>;
    setCreating: void;
};

export type DraftDeploymentState = DraftStateWithDialogsState & {
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
    port: Validatable<number>;
};

export type Status = "Editing" | "Creating" | "Created";

export const stateUpdater: WebviewStateUpdater<"draftDeployment", EventDef, DraftDeploymentState> = {
    createState: (initialState) => ({
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
        port: valid(80),
        ...initialDraftDialogState,
    }),
    vscodeMessageHandler: {
        pickLocationResponse: (state, response) => ({
            ...state,
            existingFiles: response.existingFiles,
            location: getValidatedLocation(response.location, state.deploymentSpecType, response.existingFiles),
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
        getRepoTagsResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRepoTags(state.azureReferenceData, args, args.tags),
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
            clusterResourceGroup,
            cluster: null,
            clusterNamespace: unset(),
        }),
        setCluster: (state, cluster) => ({
            ...state,
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
        setPort: (state, port) => ({
            ...state,
            port,
        }),
        setCreating: (state) => ({ ...state, status: "Creating" }),
        ...getDialogEventHandler(),
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
    launchCommand: null,
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
