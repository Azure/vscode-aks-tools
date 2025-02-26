import { useEffect } from "react";
import {
    Acr,
    Cluster,
    InitialState,
    Subscription,
} from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { Lazy, isLoaded, map as lazyMap } from "../utilities/lazy";
import { useStateManagement } from "../utilities/state";
import styles from "./AttachAcrToCluster.module.css";
import {
    EventHandlerFunc,
    ensureAcrRoleAssignmentLoaded,
    ensureAcrsLoaded,
    ensureClustersLoaded,
    ensureSubscriptionsLoaded,
} from "./state/dataLoading";
import { AttachAcrToClusterState, stateUpdater, vscode } from "./state/state";
import { distinct } from "../utilities/array";
import { ResourceSelector } from "../components/ResourceSelector";
import { faLink, faLinkSlash } from "@fortawesome/free-solid-svg-icons";
import { AcrRoleState } from "./state/stateTypes";
import { InlineAction, InlineActionProps, makeFixAction, makeInlineActionProps } from "../components/InlineAction";

export function AttachAcrToCluster(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    const updates: EventHandlerFunc[] = [];
    const {
        lazySubscriptions,
        lazyAcrResourceGroups,
        lazyClusterResourceGroups,
        lazyAcrs,
        lazyClusters,
        lazyAcrRoleState,
    } = prepareData(state, updates);
    useEffect(() => {
        updates.map((fn) => fn(eventHandlers));
    });

    function getAcrAuthorizationActionItemProps(): InlineActionProps {
        const createAction = makeFixAction(faLink, "Attach", null /* No action available yet */, true);
        const deleteAction = makeFixAction(faLinkSlash, "Detach", null /* No action available yet */, false);
        const actionItemProps = makeInlineActionProps("ACR Pull", createAction, deleteAction);

        if (state.selectedAcr === null) {
            actionItemProps.extraInfo = "Please select an ACR.";
            return actionItemProps;
        }

        if (state.selectedCluster === null) {
            actionItemProps.extraInfo = "Please select a cluster.";
            return actionItemProps;
        }

        if (!isLoaded(lazyAcrRoleState)) {
            actionItemProps.extraInfo = "Loading ACR role assignments...";
            return actionItemProps;
        }

        const roleState = lazyAcrRoleState.value;
        const acr = state.selectedAcr;
        const cluster = state.selectedCluster;
        const isDone = roleState.hasAcrPull;

        actionItemProps.isDone = isDone;
        createAction.canPerformAction = !isDone;
        createAction.action = () => handleCreateAcrRoleAssignment(acr, cluster);
        deleteAction.canPerformAction = isDone;
        deleteAction.action = () => handleDeleteAcrRoleAssignment(acr, cluster);

        return actionItemProps;
    }

    function handleCreateAcrRoleAssignment(acr: Acr, cluster: Cluster) {
        eventHandlers.onSetAcrRoleAssignmentLoading({ acrKey: acr, clusterKey: cluster });
        vscode.postCreateAcrRoleAssignmentRequest({
            acrKey: acr,
            clusterKey: cluster,
        });
    }

    function handleDeleteAcrRoleAssignment(acr: Acr, cluster: Cluster) {
        eventHandlers.onSetAcrRoleAssignmentLoading({ acrKey: acr, clusterKey: cluster });
        vscode.postDeleteAcrRoleAssignmentRequest({
            acrKey: acr,
            clusterKey: cluster,
        });
    }

    return (
        <>
            <h2>Attach Azure Container Registry to Cluster</h2>
            <fieldset className={styles.inputContainer}>
                <p className={styles.fullWidth}>
                    Select a cluster and Azure Container Registry (ACR) to attach. For more information on attaching an
                    ACR to a cluster, see{" "}
                    <a href="https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration?tabs=azure-cli#configure-acr-integration-for-an-existing-aks-cluster">
                        Configure ACR integration for an existing AKS cluster
                    </a>
                    .
                </p>
                <p className={styles.fullWidth}>
                    This operation assigns the{" "}
                    <a href="https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#acrpull">
                        AcrPull
                    </a>{" "}
                    role to the Microsoft Entra ID managed identity associated with your AKS cluster.
                </p>

                <label htmlFor="subscription-input" className={styles.label}>
                    Subscription
                </label>
                <ResourceSelector<Subscription>
                    id="subscription-input"
                    className={styles.control}
                    resources={lazySubscriptions}
                    selectedItem={state.selectedSubscription}
                    valueGetter={(s) => s.subscriptionId}
                    labelGetter={(s) => s.name}
                    onSelect={eventHandlers.onSetSelectedSubscription}
                />

                <label htmlFor="acr-rg-input" className={styles.label}>
                    ACR Resource Group
                </label>
                <ResourceSelector<string>
                    id="acr-rg-input"
                    className={styles.control}
                    resources={lazyAcrResourceGroups}
                    selectedItem={state.selectedAcrResourceGroup}
                    valueGetter={(g) => g}
                    labelGetter={(g) => g}
                    onSelect={eventHandlers.onSetSelectedAcrResourceGroup}
                />

                <label htmlFor="acr-input" className={styles.label}>
                    Container Registry
                </label>
                <ResourceSelector<Acr>
                    id="acr-input"
                    className={styles.control}
                    resources={lazyAcrs}
                    selectedItem={state.selectedAcr}
                    valueGetter={(acr) => acr.acrName}
                    labelGetter={(acr) => acr.acrName}
                    onSelect={eventHandlers.onSetSelectedAcr}
                />

                <label htmlFor="cluster-rg-input" className={styles.label}>
                    Cluster Resource Group
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

                <label htmlFor="cluster-input" className={styles.label}>
                    Cluster
                </label>
                <ResourceSelector<Cluster>
                    id="cluster-input"
                    className={styles.control}
                    resources={lazyClusters}
                    selectedItem={state.selectedCluster}
                    valueGetter={(c) => c.clusterName}
                    labelGetter={(c) => c.clusterName}
                    onSelect={eventHandlers.onSetSelectedCluster}
                />

                <label className={styles.label}>Role Assignment</label>
                <div className={`${styles.control} ${styles.actionItemList}`}>
                    <InlineAction {...getAcrAuthorizationActionItemProps()} />
                </div>
            </fieldset>
        </>
    );
}

type LocalData = {
    lazySubscriptions: Lazy<Subscription[]>;
    lazyAcrResourceGroups: Lazy<string[]>;
    lazyClusterResourceGroups: Lazy<string[]>;
    lazyAcrs: Lazy<Acr[]>;
    lazyClusters: Lazy<Cluster[]>;
    lazyAcrRoleState: Lazy<AcrRoleState>;
};

function prepareData(state: AttachAcrToClusterState, updates: EventHandlerFunc[]): LocalData {
    const lazySubscriptions = ensureSubscriptionsLoaded(state.azureReferenceData, updates);
    const lazySubscriptionAcrs = ensureAcrsLoaded(state.azureReferenceData, state.selectedSubscription, updates);
    const lazyAcrResourceGroups = lazyMap(lazySubscriptionAcrs, (acrs) => distinct(acrs.map((a) => a.resourceGroup)));
    const lazySubscriptionClusters = ensureClustersLoaded(
        state.azureReferenceData,
        state.selectedSubscription,
        updates,
    );
    const lazyClusterResourceGroups = lazyMap(lazySubscriptionClusters, (clusters) =>
        distinct(clusters.map((c) => c.resourceGroup)),
    );
    const lazyAcrs = lazyMap(lazySubscriptionAcrs, (acrs) =>
        acrs.filter((a) => a.resourceGroup === state.selectedAcrResourceGroup),
    );
    const lazyClusters = lazyMap(lazySubscriptionClusters, (clusters) =>
        clusters.filter((c) => c.resourceGroup === state.selectedClusterResourceGroup),
    );
    const lazyAcrRoleState = ensureAcrRoleAssignmentLoaded(
        state.azureReferenceData,
        state.selectedSubscription,
        state.selectedAcr,
        state.selectedCluster,
        updates,
    );

    return {
        lazySubscriptions,
        lazyAcrResourceGroups,
        lazyClusterResourceGroups,
        lazyAcrs,
        lazyClusters,
        lazyAcrRoleState,
    };
}
