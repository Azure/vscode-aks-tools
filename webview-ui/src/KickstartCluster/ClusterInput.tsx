import { faExclamationTriangle, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FormEvent, useEffect, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    ActivityFlow,
    ClusterSelections,
    DeploymentPermissionsSummary,
    ResourceGroup,
    RoleSummary,
    Subscription,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kickstartCluster";
import { TextWithDropdown } from "../components/TextWithDropdown";
import { Maybe, isNothing, just, nothing } from "../utilities/maybe";
import { EventHandlers } from "../utilities/state";
import { Validatable, hasMessage, isValid, isValueSet, missing, valid } from "../utilities/validation";
import styles from "./KickstartCluster.module.css";
import { ActivityStageList, statusClass, statusIcon } from "../components/ActivityStageList";
import { ClusterFormState, CostEstimateResult, EventDef, FlowActivity, ScanResult } from "./helpers/state";
import {
    MAX_NODE_RESOURCE_GROUP_LENGTH,
    deriveAcrName,
    deriveClusterName,
    getNodeResourceGroupName,
    getValidatedAcrName,
    getValidatedClusterName,
    getValidatedRgName,
    toBaseName,
} from "./helpers/formFields";

interface ClusterInputProps {
    subscriptions: Subscription[];
    locations: string[] | null;
    resourceGroups: ResourceGroup[] | null;
    selectedSubscriptionId: string | null;
    activity: Partial<Record<ActivityFlow, FlowActivity>>;
    scan: ScanResult | null;
    errorMessage: string | null;
    preflightCanProceed: boolean | null;
    /** RG-scoped verdict from the most recent preflight; drives the permission warning banner. */
    preflightRole: RoleSummary | null;
    /** Deployment-permissions verdict (create cluster / create registry) from the most recent preflight. */
    preflightDeployment: DeploymentPermissionsSummary | null;
    /** Incremented each time the user clicks "Re-check permissions"; causes preflight to re-fire. */
    preflightGeneration: number;
    /** Form field values, held in reducer state so they survive the Provisioning remount. */
    form: ClusterFormState;
    costEstimate: CostEstimateResult | null;
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

const QUESTION_ORDER = ["subscription", "region", "resourceGroup", "clusterName", "acrName"] as const;
type QuestionId = (typeof QUESTION_ORDER)[number];

function formatCurrency(value: number, currencyCode: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currencyCode,
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return `${currencyCode} ${value.toFixed(2)}`;
    }
}

export function renderValidationMessage(field: Validatable<unknown>) {
    if (!hasMessage(field)) return null;
    return (
        <span className={styles.validationMessage}>
            <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
            {field.message}
        </span>
    );
}

export function ClusterInput(props: ClusterInputProps) {
    const {
        appName,
        location,
        isNewResourceGroup,
        existingResourceGroup,
        newResourceGroupName,
        clusterName,
        acrName,
        uniqueSuffix,
    } = props.form;
    const updateForm = props.eventHandlers.onUpdateClusterForm;

    const [submitAttempted, setSubmitAttempted] = useState(false);
    const [showAllQuestions, setShowAllQuestions] = useState(false);
    const lastPreflightKeyRef = useRef<string | null>(null);
    const autoSelectedScanRef = useRef<number | null>(null);
    const estimateRegionRef = useRef<string | null>(null);

    const subscriptionSelected = !!props.selectedSubscriptionId;
    const subscriptionNames = props.subscriptions.map((s) => s.name);
    const selectedSubscriptionName =
        props.subscriptions.find((s) => s.id === props.selectedSubscriptionId)?.name ?? null;
    const currentLocation = isValueSet(location) ? location.value : "";
    const subscriptionScanStages = props.activity.subscriptionScan?.stages ?? [];
    const providerScanStages = subscriptionScanStages.filter((s) => s.stage === "providers");
    const regionScanStages = subscriptionScanStages.filter((s) => s.stage !== "providers");
    const preflightStages = props.activity.preflight?.stages ?? [];
    const visiblePreflightStages = preflightStages.filter((s) => s.stage !== "role");
    const preflightHasFailure = preflightStages.some((s) => s.status === "failed");
    const preflightRunning = preflightStages.length > 0 && props.preflightCanProceed === null;
    const preflightAttempted = preflightStages.length > 0 || props.preflightCanProceed !== null;
    const activeRole = props.preflightRole;
    const roleHasWarning =
        !!props.preflightRole && !(props.preflightRole.canAssignRolesKnown && props.preflightRole.canAssignRoles);
    const showRoleWarning = roleHasWarning && !preflightRunning;
    const preflightLocationValue = isValueSet(location) ? location.value : "";
    const preflightResourceGroupName = isNewResourceGroup
        ? isValid(newResourceGroupName)
            ? newResourceGroupName.value
            : ""
        : existingResourceGroup;

    // Once the cluster name, resource group, and region are all known, preview the AKS-generated node
    // resource group name and warn when it would exceed Azure's 80-character cap (it gets truncated on
    // deploy, but a heads-up lets the user choose tidier names).
    const effectiveClusterName = isValid(clusterName) ? clusterName.value : "";
    const prospectiveNodeResourceGroup =
        preflightResourceGroupName && effectiveClusterName && currentLocation
            ? getNodeResourceGroupName(preflightResourceGroupName, effectiveClusterName, currentLocation)
            : "";
    const nodeResourceGroupTooLong = prospectiveNodeResourceGroup.length > MAX_NODE_RESOURCE_GROUP_LENGTH;

    useEffect(() => {
        if (props.selectedSubscriptionId) {
            props.vscode.postGetLocationsRequest({ subscriptionId: props.selectedSubscriptionId });
            props.vscode.postGetResourceGroupsRequest({ subscriptionId: props.selectedSubscriptionId });
            props.vscode.postStartSubscriptionScanRequest({ subscriptionId: props.selectedSubscriptionId });
        }
    }, [props.selectedSubscriptionId, props.vscode]);

    useEffect(() => {
        const scan = props.scan;
        if (!scan || scan.recommendedRegion === null || autoSelectedScanRef.current === scan.runId) {
            return;
        }
        autoSelectedScanRef.current = scan.runId;
        if (isValueSet(location)) {
            return;
        }
        const region = scan.recommendedRegion;
        const timer = window.setTimeout(() => updateForm({ location: valid(region) }), 0);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.scan, location]);

    useEffect(() => {
        const seed = appName.trim();
        if (!seed) {
            return;
        }
        const base = toBaseName(seed) || "aks-app";
        const timer = window.setTimeout(() => {
            const next: Partial<ClusterFormState> = {};
            if (isNewResourceGroup && !props.form.rgEdited) {
                next.newResourceGroupName = getValidatedRgName(`${base}-rg`);
            }
            if (!props.form.clusterNameEdited) {
                next.clusterName = getValidatedClusterName(deriveClusterName(base, ""));
            }
            if (!props.form.acrNameEdited) {
                next.acrName = getValidatedAcrName(deriveAcrName(base, ""));
            }
            if (Object.keys(next).length > 0) updateForm(next);
        }, 0);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appName, isNewResourceGroup]);

    useEffect(() => {
        if (appName.trim() || !isNewResourceGroup || !isValid(newResourceGroupName)) {
            return;
        }
        if (props.form.clusterNameEdited && props.form.acrNameEdited) {
            return;
        }
        const resourceGroupName = newResourceGroupName.value;
        const timer = window.setTimeout(() => {
            const next: Partial<ClusterFormState> = {};
            if (!props.form.clusterNameEdited) {
                next.clusterName = getValidatedClusterName(deriveClusterName(resourceGroupName, uniqueSuffix));
            }
            if (!props.form.acrNameEdited) {
                next.acrName = getValidatedAcrName(deriveAcrName(resourceGroupName, uniqueSuffix));
            }
            if (Object.keys(next).length > 0) updateForm(next);
        }, 0);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newResourceGroupName, isNewResourceGroup, uniqueSuffix, appName]);

    // Auto-run preflight in the background whenever the user has supplied enough to probe
    // (subscription + location + resource group). Re-runs when any of those change. The verdict
    // gates the submit button without forcing a separate validation pane. Cluster + ACR names
    // aren't part of the probe inputs, so we trigger independently of full-form validation.
    useEffect(() => {
        if (!props.selectedSubscriptionId) {
            lastPreflightKeyRef.current = null;
            return;
        }
        if (!isValid(location)) {
            lastPreflightKeyRef.current = null;
            return;
        }
        const resourceGroupName = preflightResourceGroupName;
        if (!resourceGroupName) {
            lastPreflightKeyRef.current = null;
            return;
        }
        const key = `${props.selectedSubscriptionId}|${preflightLocationValue}|${resourceGroupName}|${isNewResourceGroup}|${props.preflightGeneration}`;
        if (lastPreflightKeyRef.current === key) return;
        lastPreflightKeyRef.current = key;
        const timer = window.setTimeout(() => {
            props.eventHandlers.onResetPreflight();
            props.vscode.postRunPreflightRequest({
                subscriptionId: props.selectedSubscriptionId!,
                location: preflightLocationValue,
                resourceGroupName,
                isNewResourceGroup,
            });
        }, 350);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        props.selectedSubscriptionId,
        preflightLocationValue,
        isNewResourceGroup,
        preflightResourceGroupName,
        props.preflightGeneration,
    ]);

    useEffect(() => {
        if (!isValid(location)) {
            estimateRegionRef.current = null;
            return;
        }
        if (estimateRegionRef.current === location.value) {
            return;
        }
        estimateRegionRef.current = location.value;
        props.vscode.postGetCostEstimateRequest({ location: location.value });
    }, [location, props.vscode]);

    function handleSubscriptionSelect(value: string | null) {
        const subscription = props.subscriptions.find((s) => s.name === value);
        const newSubscriptionId = subscription?.id ?? "";
        if (newSubscriptionId === (props.selectedSubscriptionId ?? "")) {
            return;
        }
        // The reducer clears the region and existing-RG choice, which belonged to the old subscription.
        props.eventHandlers.onSetSubscriptionSelected({ subscriptionId: newSubscriptionId });
    }

    function handleLocationSelect(value: string | null) {
        updateForm({ location: value ? valid(value) : missing<string>(l10n.t("Region is required.")) });
    }

    const resolved: Record<QuestionId, boolean> = {
        subscription: subscriptionSelected,
        region: isValid(location),
        resourceGroup: isNewResourceGroup ? isValid(newResourceGroupName) : !!existingResourceGroup,
        clusterName: isValid(clusterName),
        acrName: isValid(acrName),
    };

    function isVisible(question: QuestionId): boolean {
        if (showAllQuestions) return true;

        // Cluster and ACR inputs should appear together once RG is resolved.
        // ACR should not wait for cluster-name validation.
        if (question === "clusterName" || question === "acrName") {
            return resolved.subscription && resolved.region && resolved.resourceGroup;
        }

        const index = QUESTION_ORDER.indexOf(question);
        return QUESTION_ORDER.slice(0, index).every((earlier) => resolved[earlier]);
    }

    function validate(): Maybe<ClusterSelections> {
        const subscription = props.subscriptions.find((s) => s.id === props.selectedSubscriptionId);
        if (!subscription) return nothing();
        if (!isValid(location)) return nothing();

        let resourceGroupName: string;
        if (isNewResourceGroup) {
            if (!isValid(newResourceGroupName)) return nothing();
            resourceGroupName = newResourceGroupName.value;
        } else {
            if (!existingResourceGroup) return nothing();
            resourceGroupName = existingResourceGroup;
        }

        if (!isValid(clusterName)) return nothing();
        if (!isValid(acrName)) return nothing();

        return just({
            subscriptionId: subscription.id,
            subscriptionName: subscription.name,
            tenantId: subscription.tenantId,
            location: location.value,
            resourceGroupName,
            isNewResourceGroup,
            clusterName: clusterName.value,
            acrName: acrName.value,
        });
    }

    function submitSelections() {
        const parameters = validate();
        if (isNothing(parameters)) return;
        if (preflightRunning) return;
        if (preflightHasFailure) return;
        props.vscode.postFinishRequest(parameters.value);
        props.eventHandlers.onSetProvisioning();
    }

    function markRequiredFieldErrors() {
        const next: Partial<ClusterFormState> = {};
        if (!isValueSet(clusterName)) {
            next.clusterName = getValidatedClusterName("");
        }
        if (!isValueSet(acrName)) {
            next.acrName = getValidatedAcrName("");
        }
        if (Object.keys(next).length > 0) updateForm(next);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setSubmitAttempted(true);
        markRequiredFieldErrors();
        submitSelections();
    }

    function renderBottomWarningPanel() {
        if (!showRoleWarning) return null;

        const banner = activeRole?.actionBanner ?? null;
        const pimGrants = activeRole?.eligiblePimGrants ?? [];
        const pimRoleNames = Array.from(new Set(pimGrants.map((g) => g.roleName).filter((n) => !!n)));

        return (
            <div className={`${styles.footerWarningPanel} ${styles.fullWidth}`}>
                <span className={styles.footerWarningMessage}>
                    <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                    <span>
                        {l10n.t(
                            "You may not have permission to assign roles. You can continue now, but if this isn't resolved, deployment will pause after the resource group is created until you can assign the required role.",
                        )}
                    </span>
                </span>
                {banner ? (
                    <>
                        <span className={styles.footerWarningHint}>{banner.message}</span>
                        {(banner.nextSteps ?? []).map((step) => (
                            <span key={step} className={styles.footerWarningHint}>
                                {step}
                            </span>
                        ))}
                    </>
                ) : null}
                {pimRoleNames.length > 0 ? (
                    <span className={styles.footerWarningHint}>
                        {l10n.t("Eligible PIM role(s) detected: {0}", pimRoleNames.join(", "))}
                    </span>
                ) : null}
                <div className={styles.footerWarningActions}>
                    <button
                        type="button"
                        className={`${styles.recheckButton} ${styles.footerActionButton}`}
                        onClick={() => props.eventHandlers.onRecheckPermissions()}
                    >
                        {l10n.t("Re-check access")}
                    </button>
                </div>
            </div>
        );
    }

    function renderRegionControl() {
        if (!subscriptionSelected) {
            return (
                <input
                    type="text"
                    id="location-dropdown"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Select a subscription first")}
                    disabled
                />
            );
        }
        if (props.locations === null) {
            return (
                <input
                    type="text"
                    id="location-dropdown"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Loading…")}
                    disabled
                />
            );
        }
        return (
            <TextWithDropdown
                id="location-dropdown"
                className={styles.midControl}
                items={props.locations}
                selectedItem={currentLocation || null}
                getAddItemText={() => ""}
                allowAddItem={false}
                onSelect={handleLocationSelect}
            />
        );
    }

    function renderExistingResourceGroupControl() {
        if (!subscriptionSelected) {
            return (
                <input
                    type="text"
                    id="resource-group-dropdown"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Select a subscription first")}
                    disabled
                />
            );
        }
        if (props.resourceGroups === null) {
            return (
                <input
                    type="text"
                    id="resource-group-dropdown"
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Loading…")}
                    disabled
                />
            );
        }
        return (
            <TextWithDropdown
                id="resource-group-dropdown"
                className={styles.midControl}
                items={props.resourceGroups.map((g) => g.name)}
                selectedItem={existingResourceGroup || null}
                getAddItemText={() => ""}
                allowAddItem={false}
                onSelect={(value) => updateForm({ existingResourceGroup: value ?? "" })}
            />
        );
    }

    function renderRegionChips() {
        if (!props.scan || props.scan.regionResults.length === 0) {
            return null;
        }
        return (
            <div className={styles.chipRow}>
                <span className={styles.chipLabel}>{l10n.t("Recommended:")}</span>
                {props.scan.regionResults.map((result) => (
                    <button
                        type="button"
                        key={result.location}
                        title={result.detail}
                        className={`${styles.chip} ${currentLocation === result.location ? styles.chipSelected : ""}`}
                        onClick={() => handleLocationSelect(result.location)}
                    >
                        <FontAwesomeIcon className={statusClass[result.status]} icon={statusIcon[result.status]} />
                        {result.location}
                    </button>
                ))}
            </div>
        );
    }

    function renderCostEstimate() {
        if (!isValid(location)) {
            return null;
        }
        const result = props.costEstimate;
        const matchesRegion = !!result && result.location === currentLocation;

        if (!matchesRegion) {
            return (
                <div className={styles.costPanel}>
                    <span className={styles.costHeader}>{l10n.t("Base cost estimate (excludes workloads)")}</span>
                    <span className={styles.costLoading}>{l10n.t("Estimating costs for {0}…", currentLocation)}</span>
                </div>
            );
        }

        if (result.error || !result.estimate) {
            return (
                <div className={styles.costPanel}>
                    <span className={styles.costHeader}>{l10n.t("Base cost estimate (excludes workloads)")}</span>
                    <span className={styles.costError}>
                        <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                        {result.error ?? l10n.t("Couldn't estimate the base cost for this region.")}
                    </span>
                </div>
            );
        }

        const estimate = result.estimate;
        return (
            <div className={styles.costPanel}>
                <div className={styles.costHeaderRow}>
                    <span className={styles.costHeader}>{l10n.t("Base cost estimate (excludes workloads)")}</span>
                    <span className={styles.costTotal}>
                        {formatCurrency(estimate.monthlyTotal, estimate.currencyCode)}
                        {estimate.isApproximate ? "*" : ""}
                    </span>
                </div>
                <ul className={styles.costList}>
                    {estimate.items.map((item) => (
                        <li key={item.label} className={styles.costItem}>
                            <span className={styles.costItemLabel}>
                                {item.label}
                                {item.isApproximate ? "*" : ""}
                            </span>
                            <span className={styles.costItemValue}>
                                {formatCurrency(item.monthlyCost, estimate.currencyCode)}
                            </span>
                            <span className={styles.costItemDetail}>{item.detail}</span>
                        </li>
                    ))}
                </ul>
                <ul className={styles.costDisclaimers}>
                    {estimate.disclaimers.map((disclaimer, index) => (
                        <li key={index}>{disclaimer}</li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <form className={styles.inputContainer} onSubmit={handleSubmit}>
            <label htmlFor="app-name-input" className={styles.label}>
                {l10n.t("App name")}
            </label>
            <input
                type="text"
                id="app-name-input"
                className={styles.longControl}
                value={appName}
                placeholder={l10n.t("e.g. inventory-api")}
                onInput={(e) => updateForm({ appName: e.currentTarget.value })}
            />
            {isVisible("subscription") && (
                <>
                    <label htmlFor="subscription-dropdown" className={styles.label}>
                        {l10n.t("Subscription*")}
                    </label>
                    <TextWithDropdown
                        id="subscription-dropdown"
                        className={styles.midControl}
                        items={subscriptionNames}
                        selectedItem={selectedSubscriptionName}
                        getAddItemText={() => ""}
                        allowAddItem={false}
                        onSelect={handleSubscriptionSelect}
                    />
                    {providerScanStages.length > 0 && (
                        <div className={styles.activityContainer}>
                            <ActivityStageList stages={providerScanStages} />
                        </div>
                    )}
                </>
            )}

            {isVisible("region") && (
                <>
                    <label htmlFor="location-dropdown" className={styles.label}>
                        {l10n.t("Region*")}
                    </label>
                    {renderRegionControl()}
                    {renderRegionChips()}
                    {regionScanStages.length > 0 && (
                        <div className={styles.activityContainer}>
                            <ActivityStageList stages={regionScanStages} />
                        </div>
                    )}
                    {renderValidationMessage(location)}
                </>
            )}

            {isVisible("resourceGroup") && (
                <>
                    <label
                        htmlFor={isNewResourceGroup ? "new-resource-group-input" : "resource-group-dropdown"}
                        className={styles.label}
                    >
                        {l10n.t("Resource group*")}
                    </label>
                    {isNewResourceGroup ? (
                        <input
                            type="text"
                            id="new-resource-group-input"
                            className={styles.midControl}
                            value={isValueSet(newResourceGroupName) ? newResourceGroupName.value : ""}
                            placeholder={l10n.t("New resource group name")}
                            onInput={(e) => {
                                updateForm({
                                    rgEdited: true,
                                    newResourceGroupName: getValidatedRgName(e.currentTarget.value),
                                });
                            }}
                        />
                    ) : (
                        renderExistingResourceGroupControl()
                    )}
                    <button
                        type="button"
                        className={styles.sideControl}
                        onClick={() => updateForm({ isNewResourceGroup: !isNewResourceGroup })}
                    >
                        {isNewResourceGroup ? l10n.t("Use existing") : l10n.t("Create new")}
                    </button>
                    {isNewResourceGroup && renderValidationMessage(newResourceGroupName)}
                </>
            )}

            {isVisible("clusterName") && (
                <>
                    <label htmlFor="cluster-name-input" className={styles.label}>
                        {l10n.t("Cluster name*")}
                    </label>
                    <input
                        type="text"
                        id="cluster-name-input"
                        className={styles.longControl}
                        value={isValueSet(clusterName) ? clusterName.value : ""}
                        onInput={(e) => {
                            updateForm({
                                clusterNameEdited: true,
                                clusterName: getValidatedClusterName(e.currentTarget.value),
                            });
                        }}
                    />
                    {renderValidationMessage(clusterName)}
                    {nodeResourceGroupTooLong && (
                        <span className={styles.validationMessage}>
                            <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                            {l10n.t(
                                "Heads up: the node resource group name (MC_…) would be {0} characters, over Azure's {1}-character limit, so it will be shortened automatically. Shorten the cluster name or resource group name for a cleaner name.",
                                prospectiveNodeResourceGroup.length,
                                MAX_NODE_RESOURCE_GROUP_LENGTH,
                            )}
                        </span>
                    )}
                </>
            )}

            {isVisible("acrName") && (
                <>
                    <label htmlFor="acr-name-input" className={styles.label}>
                        {l10n.t("Container registry name*")}
                    </label>
                    <input
                        type="text"
                        id="acr-name-input"
                        className={styles.longControl}
                        value={isValueSet(acrName) ? acrName.value : ""}
                        onInput={(e) => {
                            updateForm({
                                acrNameEdited: true,
                                acrName: getValidatedAcrName(e.currentTarget.value),
                            });
                        }}
                    />
                    {renderValidationMessage(acrName)}
                </>
            )}

            {props.errorMessage && (
                <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                    <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                    {props.errorMessage}
                </span>
            )}
            {submitAttempted && isNothing(validate()) && (
                <span className={`${styles.validationMessage} ${styles.fullWidth}`}>
                    {l10n.t("Please complete all required fields before continuing.")}
                </span>
            )}

            {preflightAttempted && visiblePreflightStages.length > 0 && (
                <div className={`${styles.activityContainer} ${styles.fullWidth}`}>
                    <ActivityStageList stages={visiblePreflightStages} />
                </div>
            )}

            {renderBottomWarningPanel()}
            {renderCostEstimate()}

            <div className={`${styles.buttonContainer} ${styles.fullWidth}`}>
                <button
                    type="submit"
                    disabled={preflightRunning || preflightHasFailure}
                    title={
                        preflightRunning
                            ? l10n.t("Running pre-flight checks...")
                            : preflightHasFailure
                              ? l10n.t("Fix the failed check before continuing.")
                              : undefined
                    }
                >
                    {preflightRunning ? l10n.t("Checking...") : l10n.t("Create cluster")}
                </button>
                <label className={styles.showAllToggle}>
                    <input
                        type="checkbox"
                        checked={showAllQuestions}
                        onChange={(e) => setShowAllQuestions(e.currentTarget.checked)}
                    />
                    {l10n.t("Show all questions")}
                </label>
            </div>
        </form>
    );
}
