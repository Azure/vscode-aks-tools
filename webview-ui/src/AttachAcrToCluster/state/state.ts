import {
    Acr,
    AcrKey,
    Cluster,
    ClusterKey,
    InitialSelection,
    Subscription,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { newNotLoaded } from "../../utilities/lazy";
import { WebviewStateUpdater } from "../../utilities/state";
import { AzureReferenceData } from "./stateTypes";
import * as AzureReferenceDataUpdate from "./update/azureReferenceDataUpdate";
import { getWebviewMessageContext } from "../../utilities/vscode";

export type EventDef = {
    // Reference data loading
    setSubscriptionsLoading: void;
    setAcrsLoading: SubscriptionKey;
    setClustersLoading: SubscriptionKey;
    setAcrRoleAssignmentLoading: {
        acrKey: AcrKey;
        clusterKey: ClusterKey;
    };

    // Azure resource selections
    setSelectedSubscription: Subscription | null;
    setSelectedAcrResourceGroup: string | null;
    setSelectedClusterResourceGroup: string | null;
    setSelectedAcr: Acr | null;
    setSelectedCluster: Cluster | null;
};

export type AttachAcrToClusterState = {
    // Reference data
    azureReferenceData: AzureReferenceData;

    // Properties waiting to be automatically selected when data is available
    pendingSelection: InitialSelection;

    // Azure resource selections
    selectedSubscription: Subscription | null;
    selectedAcrResourceGroup: string | null;
    selectedClusterResourceGroup: string | null;
    selectedAcr: Acr | null;
    selectedCluster: Cluster | null;
};

export const stateUpdater: WebviewStateUpdater<"attachAcrToCluster", EventDef, AttachAcrToClusterState> = {
    createState: (initialState) => ({
        // Reference data
        azureReferenceData: {
            subscriptions: newNotLoaded(),
        },

        // Pending selections
        pendingSelection: {
            ...initialState.initialSelection,
        },

        // Selected items
        selectedSubscription: null,
        selectedAcrResourceGroup: null,
        selectedClusterResourceGroup: null,
        selectedAcr: null,
        selectedCluster: null,
    }),
    vscodeMessageHandler: {
        // Reference data responses
        getSubscriptionsResponse: (state, args) => ({
            ...state,
            selectedSubscription: getSelectedValue(
                args.subscriptions,
                (s) => s.subscriptionId === state.pendingSelection.subscriptionId,
            ),
            selectedAcrResourceGroup: null,
            selectedClusterResourceGroup: null,
            selectedAcr: null,
            selectedCluster: null,
            azureReferenceData: AzureReferenceDataUpdate.updateSubscriptions(
                state.azureReferenceData,
                args.subscriptions,
            ),
        }),
        getAcrsResponse: (state, args) => ({
            ...state,
            selectedAcrResourceGroup: getSelectedValue(
                args.acrs.map((acr) => acr.resourceGroup),
                (rg) => rg === state.pendingSelection.acrResourceGroup,
            ),
            selectedAcr: getSelectedValue(
                args.acrs,
                (acr) =>
                    acr.resourceGroup === state.pendingSelection.acrResourceGroup &&
                    acr.acrName === state.pendingSelection.acrName,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateAcrs(
                state.azureReferenceData,
                args.key.subscriptionId,
                args.acrs,
            ),
        }),
        getClustersResponse: (state, args) => ({
            ...state,
            selectedClusterResourceGroup: getSelectedValue(
                args.clusters.map((c) => c.resourceGroup),
                (rg) => rg === state.pendingSelection.clusterResourceGroup,
            ),
            selectedCluster: getSelectedValue(
                args.clusters,
                (c) =>
                    c.resourceGroup === state.pendingSelection.clusterResourceGroup &&
                    c.clusterName === state.pendingSelection.clusterName,
            ),
            azureReferenceData: AzureReferenceDataUpdate.updateClusters(
                state.azureReferenceData,
                args.key.subscriptionId,
                args.clusters,
            ),
        }),

        // Azure resource role assignment responses
        getAcrRoleAssignmentResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRoleAssignment(
                state.azureReferenceData,
                args.acrKey,
                args.clusterKey,
                args.hasAcrPull,
            ),
        }),
        createAcrRoleAssignmentResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRoleAssignment(
                state.azureReferenceData,
                args.acrKey,
                args.clusterKey,
                args.hasAcrPull,
            ),
        }),
        deleteAcrRoleAssignmentResponse: (state, args) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.updateAcrRoleAssignment(
                state.azureReferenceData,
                args.acrKey,
                args.clusterKey,
                args.hasAcrPull,
            ),
        }),
    },
    eventHandler: {
        // Reference data loading
        setSubscriptionsLoading: (state) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setSubscriptionsLoading(state.azureReferenceData),
        }),
        setAcrsLoading: (state, key) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setAcrsLoading(state.azureReferenceData, key.subscriptionId),
        }),
        setClustersLoading: (state, key) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setClustersLoading(
                state.azureReferenceData,
                key.subscriptionId,
            ),
        }),
        setAcrRoleAssignmentLoading: (state, msg) => ({
            ...state,
            azureReferenceData: AzureReferenceDataUpdate.setAcrRoleAssignmentLoading(
                state.azureReferenceData,
                msg.acrKey,
                msg.clusterKey,
            ),
        }),

        // Azure resource selections
        setSelectedSubscription: (state, sub) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, subscriptionId: undefined },
            selectedSubscription: sub,
            selectedAcrResourceGroup: null,
            selectedAcr: null,
            selectedClusterResourceGroup: null,
            selectedCluster: null,
        }),
        setSelectedAcrResourceGroup: (state, rg) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrResourceGroup: undefined },
            selectedAcrResourceGroup: rg,
            selectedAcr: null,
        }),
        setSelectedClusterResourceGroup: (state, rg) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterResourceGroup: undefined },
            selectedClusterResourceGroup: rg,
            selectedCluster: null,
        }),
        setSelectedAcr: (state, acr) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, acrName: undefined },
            selectedAcr: acr,
        }),
        setSelectedCluster: (state, cluster) => ({
            ...state,
            pendingSelection: { ...state.pendingSelection, clusterName: undefined },
            selectedCluster: cluster,
        }),
    },
};

export const vscode = getWebviewMessageContext<"attachAcrToCluster">({
    getSubscriptionsRequest: null,
    getAcrsRequest: null,
    getClustersRequest: null,
    getAcrRoleAssignmentRequest: null,
    createAcrRoleAssignmentRequest: null,
    deleteAcrRoleAssignmentRequest: null,
});

function getSelectedValue<TItem>(items: TItem[], matchesInitialValue: (item: TItem) => boolean): TItem | null {
    if (items.length === 1) {
        return items[0];
    }

    const initialItem = items.find(matchesInitialValue);
    if (initialItem) {
        return initialItem;
    }

    return null;
}
