import { useEffect } from "react";
import {
    Acr,
    Cluster,
    InitialState,
    Subscription,
} from "../../../src/webview-contract/webviewDefinitions/connectAcrToCluster";
import { Lazy, isLoaded, map as lazyMap } from "../utilities/lazy";
import { useStateManagement } from "../utilities/state";
import styles from "./ConnectAcrToCluster.module.css";
import {
    EventHandlerFunc,
    ensureAcrRoleAssignmentLoaded,
    ensureAcrsLoaded,
    ensureClustersLoaded,
    ensureSubscriptionsLoaded,
} from "./state/dataLoading";
import { ConnectAcrToClusterState, stateUpdater, vscode } from "./state/state";
import { distinct } from "../utilities/array";
import { ResourceSelector } from "../components/ResourceSelector";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconDefinition, faCheckCircle, faClock, faSave, faTrash } from "@fortawesome/free-solid-svg-icons";
import { AcrRoleState } from "./state/stateTypes";

export function ConnectAcrToCluster(initialState: InitialState) {
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

    function getAcrAuthorizationActionItemProps(): ActionItemProps {
        const createAction = makeFixAction(faSave, "Authorize", null /* No action available yet */);
        const deleteAction = makeFixAction(faTrash, "Deauthorize", null /* No action available yet */);
        const actionItemProps = makeActionItemProps("ACR Pull", createAction, deleteAction);

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
            <h2>Connect ACR to Cluster</h2>
            <fieldset className={styles.inputContainer}>
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

                <label className={styles.label}>Authorization</label>
                <div className={`${styles.control} ${styles.actionItemList}`}>
                    <ActionItem {...getAcrAuthorizationActionItemProps()} />
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

function prepareData(state: ConnectAcrToClusterState, updates: EventHandlerFunc[]): LocalData {
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

function makeFixAction(icon: IconDefinition, name: string, action: (() => void) | null): FixAction {
    return {
        icon,
        name,
        action: action ? action : () => {},
        canPerformAction: action !== null,
    };
}

function makeActionItemProps(description: string, ...actions: FixAction[]): ActionItemProps {
    return {
        isDone: false,
        description,
        actions,
        extraInfo: "",
    };
}

type ActionItemProps = {
    isDone: boolean;
    description: string;
    actions: FixAction[];
    extraInfo: string;
};

type FixAction = {
    canPerformAction: boolean;
    icon: IconDefinition;
    action: () => void;
    name: string;
};

function ActionItem(props: ActionItemProps) {
    return (
        <div className={styles.actionItem}>
            <div className={styles.actionDescription}>
                {props.isDone ? (
                    <FontAwesomeIcon icon={faCheckCircle} className={styles.successIndicator} />
                ) : (
                    <FontAwesomeIcon icon={faClock} />
                )}{" "}
                {props.description}{" "}
                {props.extraInfo && (
                    <span className={"tooltip-holder"} data-tooltip-text={props.extraInfo}>
                        <i className={`${styles.inlineIcon} codicon codicon-info`} />
                    </span>
                )}
            </div>
            <div className={styles.actionButtons}>
                {props.actions.map((action, i) => (
                    <VSCodeButton
                        key={i}
                        appearance="secondary"
                        onClick={action.action}
                        disabled={!action.canPerformAction}
                        title={action.name}
                    >
                        <span className={styles.inlineIcon}>
                            <FontAwesomeIcon icon={action.icon} />
                        </span>
                    </VSCodeButton>
                ))}
            </div>
        </div>
    );
}
