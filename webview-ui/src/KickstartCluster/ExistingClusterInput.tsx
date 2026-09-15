import { faExclamationTriangle, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import * as l10n from "@vscode/l10n";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    ConnectedAcr,
    DeploymentPermissionsSummary,
    ExistingCluster,
    ExistingClusterSelection,
    Subscription,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kickstartCluster";
import { statusClass, statusIcon } from "../components/ActivityStageList";
import { ProgressRing } from "../components/ProgressRing";
import { SearchableDropdown } from "../components/SearchableDropdown";
import { EventHandlers } from "../utilities/state";
import { Validatable, isValid, isValueSet, unset } from "../utilities/validation";
import { deriveAcrName, getValidatedAcrName, randomSuffix, renderValidationMessage } from "./ClusterInput";
import { EventDef } from "./helpers/state";
import styles from "./KickstartCluster.module.css";

interface ExistingClusterInputProps {
    subscriptions: Subscription[];
    selectedSubscriptionId: string | null;
    clusters: ExistingCluster[] | null;
    selectedCluster: ExistingCluster | null;
    connectedAcrs: ConnectedAcr[] | null;
    detectingAcrs: boolean;
    existingReadiness: DeploymentPermissionsSummary | null;
    existingReadinessKey: string | null;
    errorMessage: string | null;
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

function clusterLabel(cluster: ExistingCluster): string {
    return `${cluster.name} (${cluster.resourceGroup})`;
}

export function ExistingClusterInput(props: ExistingClusterInputProps) {
    const [selectedAcrName, setSelectedAcrName] = useState<string | null>(null);
    const [newAcrName, setNewAcrName] = useState<Validatable<string>>(unset());
    const [acrSubmitAttempted, setAcrSubmitAttempted] = useState(false);
    const [uniqueSuffix] = useState(() => randomSuffix(4));

    const subscriptionNames = props.subscriptions.map((s) => s.name);
    const selectedSubscriptionName =
        props.subscriptions.find((s) => s.id === props.selectedSubscriptionId)?.name ?? null;
    const subscriptionSelected = !!props.selectedSubscriptionId;

    useEffect(() => {
        if (props.selectedSubscriptionId && props.clusters === null) {
            props.vscode.postGetClustersRequest({ subscriptionId: props.selectedSubscriptionId });
        }
    }, [props.selectedSubscriptionId, props.clusters, props.vscode]);

    useEffect(() => {
        if (props.selectedSubscriptionId && props.selectedCluster && props.detectingAcrs) {
            props.vscode.postDetectClusterAcrsRequest({
                subscriptionId: props.selectedSubscriptionId,
                clusterResourceGroup: props.selectedCluster.resourceGroup,
                clusterName: props.selectedCluster.name,
            });
        }
    }, [props.selectedSubscriptionId, props.selectedCluster, props.detectingAcrs, props.vscode]);

    useEffect(() => {
        if (
            props.selectedCluster &&
            props.connectedAcrs !== null &&
            props.connectedAcrs.length === 0 &&
            !isValueSet(newAcrName)
        ) {
            const cluster = props.selectedCluster;
            const timer = window.setTimeout(
                () => setNewAcrName(getValidatedAcrName(deriveAcrName(cluster.name, uniqueSuffix))),
                0,
            );
            return () => window.clearTimeout(timer);
        }
        return;
    }, [props.selectedCluster, props.connectedAcrs, newAcrName, uniqueSuffix]);

    function handleSubscriptionSelect(value: string | null) {
        const subscription = props.subscriptions.find((s) => s.name === value);
        const newSubscriptionId = subscription?.id ?? "";
        if (newSubscriptionId === (props.selectedSubscriptionId ?? "")) {
            return;
        }
        props.eventHandlers.onSetSubscriptionSelected({ subscriptionId: newSubscriptionId });
    }

    function handleClusterSelect(value: string | null) {
        const cluster = (props.clusters ?? []).find((c) => clusterLabel(c) === value);
        if (cluster) {
            setSelectedAcrName(null);
            setNewAcrName(unset());
            setAcrSubmitAttempted(false);
            props.eventHandlers.onSetExistingClusterSelected({ cluster });
        }
    }

    function buildSelection(
        createNewAcr: boolean,
        acrName: string,
        acrResourceGroup: string,
    ): ExistingClusterSelection | null {
        const subscription = props.subscriptions.find((s) => s.id === props.selectedSubscriptionId);
        if (!subscription || !props.selectedCluster) {
            return null;
        }
        return {
            subscriptionId: subscription.id,
            subscriptionName: subscription.name,
            tenantId: subscription.tenantId,
            clusterName: props.selectedCluster.name,
            clusterResourceGroup: props.selectedCluster.resourceGroup,
            createNewAcr,
            acrName,
            acrResourceGroup,
        };
    }

    function submitSelection(selection: ExistingClusterSelection | null) {
        if (!selection) {
            return;
        }
        props.vscode.postUseExistingClusterRequest(selection);
        props.eventHandlers.onSetProvisioning();
    }

    const effectiveAcrName = selectedAcrName ?? props.connectedAcrs?.[0]?.name ?? null;

    useEffect(() => {
        if (!props.selectedSubscriptionId || !props.selectedCluster) {
            return;
        }
        if (props.detectingAcrs || props.connectedAcrs === null) {
            return;
        }
        const connectedAcr = props.connectedAcrs.find((a) => a.name === effectiveAcrName) ?? null;
        const acrName = connectedAcr?.name;
        const acrResourceGroup = connectedAcr?.resourceGroup;
        const key = `${props.selectedSubscriptionId}|${props.selectedCluster.resourceGroup}|${props.selectedCluster.name}|${acrName ?? ""}`;
        if (props.existingReadinessKey === key) {
            return;
        }
        props.eventHandlers.onSetExistingReadinessPending({ key });
        props.vscode.postRunExistingReadinessRequest({
            subscriptionId: props.selectedSubscriptionId,
            clusterResourceGroup: props.selectedCluster.resourceGroup,
            clusterName: props.selectedCluster.name,
            acrName,
            acrResourceGroup,
            requestKey: key,
        });
    }, [
        props.selectedSubscriptionId,
        props.selectedCluster,
        props.connectedAcrs,
        props.detectingAcrs,
        props.existingReadinessKey,
        effectiveAcrName,
        props.eventHandlers,
        props.vscode,
    ]);

    function handleUseConnected() {
        const acr = (props.connectedAcrs ?? []).find((a) => a.name === effectiveAcrName);
        if (!acr) {
            return;
        }
        submitSelection(buildSelection(false, acr.name, acr.resourceGroup));
    }

    function handleCreateAndUse() {
        setAcrSubmitAttempted(true);
        if (!isValid(newAcrName) || !props.selectedCluster) {
            return;
        }
        submitSelection(buildSelection(true, newAcrName.value, props.selectedCluster.resourceGroup));
    }

    function renderClusterControl() {
        if (!subscriptionSelected) {
            return (
                <input
                    type="text"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Select a subscription first")}
                    disabled
                />
            );
        }
        if (props.clusters === null) {
            return (
                <input type="text" className={styles.midControl} value="" placeholder={l10n.t("Loading…")} disabled />
            );
        }
        if (props.clusters.length === 0) {
            return (
                <input
                    type="text"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("No clusters found in this subscription")}
                    disabled
                />
            );
        }
        return (
            <SearchableDropdown
                id="existing-cluster-dropdown"
                className={styles.midControl}
                items={props.clusters.map(clusterLabel)}
                selectedValue={props.selectedCluster ? clusterLabel(props.selectedCluster) : null}
                getValue={(s) => s}
                onSelect={handleClusterSelect}
            />
        );
    }

    function renderAcrSection() {
        if (!props.selectedCluster) {
            return null;
        }
        if (props.detectingAcrs || props.connectedAcrs === null) {
            return (
                <div className={styles.detectRow}>
                    <ProgressRing />
                    <span>{l10n.t("Checking for connected registries…")}</span>
                </div>
            );
        }
        if (props.connectedAcrs.length > 0) {
            const acrNames = props.connectedAcrs.map((a) => a.name);
            const selectedAcr = props.connectedAcrs.find((a) => a.name === effectiveAcrName) ?? null;
            return (
                <>
                    <label htmlFor="connected-acr-dropdown" className={styles.label}>
                        {l10n.t("Connected registry*")}
                    </label>
                    <SearchableDropdown
                        id="connected-acr-dropdown"
                        className={styles.midControl}
                        items={acrNames}
                        selectedValue={effectiveAcrName}
                        getValue={(s) => s}
                        onSelect={(value) => setSelectedAcrName(value)}
                    />
                    {selectedAcr && <span className={styles.hint}>{selectedAcr.loginServer}</span>}
                    <div className={`${styles.buttonContainer} ${styles.fullWidth}`}>
                        <button type="button" onClick={handleUseConnected} disabled={!selectedAcr}>
                            {l10n.t("Use this registry and continue")}
                        </button>
                    </div>
                </>
            );
        }
        return (
            <>
                <span className={styles.permissionWarning}>
                    <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                    {l10n.t(
                        "We didn't find a registry directly connected to this cluster. We'll create one and grant the cluster pull access.",
                    )}
                </span>
                <label htmlFor="new-acr-name-input" className={styles.label}>
                    {l10n.t("New registry name*")}
                </label>
                <input
                    type="text"
                    id="new-acr-name-input"
                    className={styles.longControl}
                    value={isValueSet(newAcrName) ? newAcrName.value : ""}
                    onInput={(e) => setNewAcrName(getValidatedAcrName(e.currentTarget.value))}
                />
                {renderValidationMessage(newAcrName)}
                <div className={`${styles.buttonContainer} ${styles.fullWidth}`}>
                    <button type="button" onClick={handleCreateAndUse}>
                        {l10n.t("Create registry and continue")}
                    </button>
                </div>
                {acrSubmitAttempted && !isValid(newAcrName) && (
                    <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                        {l10n.t("Please enter a valid registry name before continuing.")}
                    </span>
                )}
            </>
        );
    }

    function renderReadinessPanel() {
        if (!props.selectedCluster) {
            return null;
        }
        if (props.detectingAcrs || props.connectedAcrs === null) {
            return null;
        }
        const readiness = props.existingReadiness;
        if (readiness === null) {
            return (
                <div className={styles.costPanel}>
                    <span className={styles.costHeader}>{l10n.t("Deployment readiness")}</span>
                    <div className={styles.detectRow}>
                        <ProgressRing />
                        <span>{l10n.t("Checking your deployment permissions…")}</span>
                    </div>
                </div>
            );
        }
        if (!readiness.known) {
            return (
                <div className={styles.costPanel}>
                    <span className={styles.costHeader}>{l10n.t("Deployment readiness")}</span>
                    <span className={styles.costItemDetail}>{readiness.detail}</span>
                </div>
            );
        }
        return (
            <div className={styles.costPanel}>
                <span className={styles.costHeader}>{l10n.t("Deployment readiness")}</span>
                <span className={styles.costItemDetail}>{readiness.detail}</span>
                {readiness.actions.map((action) => {
                    const status = action.granted ? "succeeded" : "warning";
                    return (
                        <span key={action.action} className={styles.permissionWarning}>
                            <FontAwesomeIcon className={statusClass[status]} icon={statusIcon[status]} />
                            <span className={styles.permissionWarningBody}>
                                <span>{action.label}</span>
                                {action.detail && <span className={styles.permissionWarningHint}>{action.detail}</span>}
                            </span>
                        </span>
                    );
                })}
            </div>
        );
    }

    return (
        <div className={styles.inputContainer}>
            <label htmlFor="existing-subscription-dropdown" className={styles.label}>
                {l10n.t("Subscription*")}
            </label>
            <SearchableDropdown
                id="existing-subscription-dropdown"
                className={styles.midControl}
                items={subscriptionNames}
                selectedValue={selectedSubscriptionName}
                getValue={(s) => s}
                onSelect={handleSubscriptionSelect}
            />

            <label htmlFor="existing-cluster-dropdown" className={styles.label}>
                {l10n.t("Cluster*")}
            </label>
            {renderClusterControl()}

            {renderAcrSection()}

            {renderReadinessPanel()}

            {props.errorMessage && (
                <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                    {props.errorMessage}
                </span>
            )}
        </div>
    );
}
