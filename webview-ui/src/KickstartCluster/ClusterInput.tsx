import { faExclamationTriangle, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FormEvent, useEffect, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import { MessageSink } from "../../../src/webview-contract/messaging";
import {
    ActivityFlow,
    ClusterLaunchContext,
    ClusterSelections,
    ResourceGroup,
    Subscription,
    ToVsCodeMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kickstartCluster";
import { TextWithDropdown } from "../components/TextWithDropdown";
import { Maybe, isNothing, just, nothing } from "../utilities/maybe";
import { EventHandlers } from "../utilities/state";
import { Validatable, hasMessage, invalid, isValid, isValueSet, missing, unset, valid } from "../utilities/validation";
import styles from "./KickstartCluster.module.css";
import { PreflightChecklist } from "../components/PreflightChecklist";
import { ActivityStageList, statusClass, statusIcon } from "../components/ActivityStageList";
import { EventDef, FlowActivity, ScanResult } from "./helpers/state";

interface ClusterInputProps {
    subscriptions: Subscription[];
    locations: string[] | null;
    resourceGroups: ResourceGroup[] | null;
    selectedSubscriptionId: string | null;
    activity: Partial<Record<ActivityFlow, FlowActivity>>;
    scan: ScanResult | null;
    errorMessage: string | null;
    preflightCanProceed: boolean | null;
    launchContext: ClusterLaunchContext;
    eventHandlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

const QUESTION_ORDER = ["subscription", "region", "resourceGroup", "clusterName", "acrName"] as const;
type QuestionId = (typeof QUESTION_ORDER)[number];

function getValidatedClusterName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Cluster name is required."));
    if (value.length > 63) return invalid(value, l10n.t("Cluster name must be at most 63 characters long."));
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(value)) {
        return invalid(
            value,
            l10n.t(
                "Only letters, numbers, dashes, and underscores are allowed. The first and last character must be a letter or number.",
            ),
        );
    }
    return valid(value);
}

export function getValidatedAcrName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Registry name is required."));
    if (!/^[a-zA-Z0-9]{5,50}$/.test(value)) {
        return invalid(value, l10n.t("Registry name must be 5-50 alphanumeric characters (no dashes)."));
    }
    return valid(value);
}

function getValidatedRgName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Resource group name is required."));
    if (value.length > 90) return invalid(value, l10n.t("Resource group name must be at most 90 characters."));
    if (!/^[-\w._()]+$/.test(value) || value.endsWith(".")) {
        return invalid(value, l10n.t("Resource group name contains invalid characters."));
    }
    return valid(value);
}

export function randomSuffix(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
}

function deriveClusterName(resourceGroupName: string, suffix: string): string {
    const base = resourceGroupName.replace(/[^a-zA-Z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "") || "aks";
    return `${base.slice(0, 63 - suffix.length - 1)}-${suffix}`;
}

export function deriveAcrName(resourceGroupName: string, suffix: string): string {
    const base = resourceGroupName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "acr";
    return `${base.slice(0, 50 - suffix.length)}${suffix}`;
}

function toBaseName(appName: string): string {
    return appName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function ClusterInput(props: ClusterInputProps) {
    const [appName, setAppName] = useState<string>(props.launchContext.appName ?? "");
    const [location, setLocation] = useState<Validatable<string>>(
        props.launchContext.suggestedLocation ? valid(props.launchContext.suggestedLocation) : unset(),
    );
    const [isNewResourceGroup, setIsNewResourceGroup] = useState(true);
    const [existingResourceGroup, setExistingResourceGroup] = useState<string>("");
    const [newResourceGroupName, setNewResourceGroupName] = useState<Validatable<string>>(unset());
    const [clusterName, setClusterName] = useState<Validatable<string>>(
        props.launchContext.suggestedClusterName
            ? getValidatedClusterName(props.launchContext.suggestedClusterName)
            : unset(),
    );
    const [acrName, setAcrName] = useState<Validatable<string>>(
        props.launchContext.suggestedAcrName ? getValidatedAcrName(props.launchContext.suggestedAcrName) : unset(),
    );
    const [submitAttempted, setSubmitAttempted] = useState(false);
    const [showAllQuestions, setShowAllQuestions] = useState(false);
    const [phase, setPhase] = useState<"form" | "preflight">("form");
    const [pendingSelections, setPendingSelections] = useState<ClusterSelections | null>(null);
    const autoSelectedScanRef = useRef<number | null>(null);
    const [uniqueSuffix] = useState(() => randomSuffix(4));
    const rgEditedRef = useRef(false);
    const clusterNameEditedRef = useRef(!!props.launchContext.suggestedClusterName);
    const acrNameEditedRef = useRef(!!props.launchContext.suggestedAcrName);

    const subscriptionSelected = !!props.selectedSubscriptionId;
    const subscriptionNames = props.subscriptions.map((s) => s.name);
    const selectedSubscriptionName =
        props.subscriptions.find((s) => s.id === props.selectedSubscriptionId)?.name ?? null;
    const currentLocation = isValueSet(location) ? location.value : "";
    const subscriptionScanStages = props.activity.subscriptionScan?.stages ?? [];

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
        const timer = window.setTimeout(() => setLocation(valid(region)), 0);
        return () => window.clearTimeout(timer);
    }, [props.scan, location]);

    useEffect(() => {
        const seed = appName.trim();
        if (!seed) {
            return;
        }
        const base = toBaseName(seed) || "aks-app";
        const timer = window.setTimeout(() => {
            if (isNewResourceGroup && !rgEditedRef.current) {
                setNewResourceGroupName(getValidatedRgName(`${base}-rg`));
            }
            if (!clusterNameEditedRef.current) {
                setClusterName(getValidatedClusterName(deriveClusterName(base, uniqueSuffix)));
            }
            if (!acrNameEditedRef.current) {
                setAcrName(getValidatedAcrName(deriveAcrName(base, uniqueSuffix)));
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [appName, isNewResourceGroup, uniqueSuffix]);

    useEffect(() => {
        if (appName.trim() || !isNewResourceGroup || !isValid(newResourceGroupName)) {
            return;
        }
        if (clusterNameEditedRef.current && acrNameEditedRef.current) {
            return;
        }
        const resourceGroupName = newResourceGroupName.value;
        const timer = window.setTimeout(() => {
            if (!clusterNameEditedRef.current) {
                setClusterName(getValidatedClusterName(deriveClusterName(resourceGroupName, uniqueSuffix)));
            }
            if (!acrNameEditedRef.current) {
                setAcrName(getValidatedAcrName(deriveAcrName(resourceGroupName, uniqueSuffix)));
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [newResourceGroupName, isNewResourceGroup, uniqueSuffix, appName]);

    useEffect(() => {
        if (phase === "preflight" && props.preflightCanProceed === true && pendingSelections) {
            props.vscode.postFinishRequest(pendingSelections);
            props.eventHandlers.onSetProvisioning();
        }
    }, [phase, props.preflightCanProceed, pendingSelections, props.vscode, props.eventHandlers]);

    function handleSubscriptionSelect(value: string | null) {
        const subscription = props.subscriptions.find((s) => s.name === value);
        setLocation(unset());
        setExistingResourceGroup("");
        props.eventHandlers.onSetSubscriptionSelected({ subscriptionId: subscription?.id ?? "" });
    }

    function handleLocationSelect(value: string | null) {
        setLocation(value ? valid(value) : missing<string>(l10n.t("Region is required.")));
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

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setSubmitAttempted(true);
        const parameters = validate();
        if (isNothing(parameters)) return;
        startPreflight(parameters.value);
    }

    function startPreflight(selections: ClusterSelections) {
        setPendingSelections(selections);
        setPhase("preflight");
        props.eventHandlers.onResetPreflight();
        props.vscode.postRunPreflightRequest({
            subscriptionId: selections.subscriptionId,
            location: selections.location,
        });
    }

    function handleRetry() {
        if (pendingSelections) {
            startPreflight(pendingSelections);
        }
    }

    function renderValidationMessage(field: Validatable<unknown>) {
        if (!hasMessage(field)) return null;
        return (
            <span className={styles.validationMessage}>
                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                {field.message}
            </span>
        );
    }

    function renderPermissionWarning() {
        const role = props.scan?.role;
        if (!role || (role.canAssignRolesKnown && role.canAssignRoles)) {
            return null;
        }
        const message = role.canAssignRolesKnown
            ? l10n.t(
                  "You may not have permission to assign the ACR pull and cluster RBAC roles. An Owner or User Access Administrator may need to complete those assignments.",
              )
            : l10n.t("We couldn't verify whether you can assign the ACR pull and cluster RBAC roles.");
        return (
            <span className={styles.permissionWarning}>
                <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                {message}
            </span>
        );
    }

    function renderRegionControl() {
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
        if (props.locations === null) {
            return (
                <input type="text" className={styles.midControl} value="" placeholder={l10n.t("Loading…")} disabled />
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
                    className={styles.midControl}
                    value=""
                    placeholder={l10n.t("Select a subscription first")}
                    disabled
                />
            );
        }
        if (props.resourceGroups === null) {
            return (
                <input type="text" className={styles.midControl} value="" placeholder={l10n.t("Loading…")} disabled />
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
                onSelect={(value) => setExistingResourceGroup(value ?? "")}
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

    if (phase === "preflight") {
        return (
            <PreflightChecklist
                stages={props.activity.preflight?.stages ?? []}
                canProceed={props.preflightCanProceed}
                onBack={() => setPhase("form")}
                onRetry={handleRetry}
            />
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
                onInput={(e) => setAppName(e.currentTarget.value)}
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
                    {subscriptionScanStages.length > 0 && (
                        <div className={styles.activityContainer}>
                            <ActivityStageList stages={subscriptionScanStages} />
                        </div>
                    )}
                    {renderPermissionWarning()}
                </>
            )}

            {isVisible("region") && (
                <>
                    <label htmlFor="location-dropdown" className={styles.label}>
                        {l10n.t("Region*")}
                    </label>
                    {renderRegionControl()}
                    {renderRegionChips()}
                    {renderValidationMessage(location)}
                </>
            )}

            {isVisible("resourceGroup") && (
                <>
                    <label htmlFor="resource-group-dropdown" className={styles.label}>
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
                                rgEditedRef.current = true;
                                setNewResourceGroupName(getValidatedRgName(e.currentTarget.value));
                            }}
                        />
                    ) : (
                        renderExistingResourceGroupControl()
                    )}
                    <button
                        type="button"
                        className={styles.sideControl}
                        onClick={() => setIsNewResourceGroup((v) => !v)}
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
                            clusterNameEditedRef.current = true;
                            setClusterName(getValidatedClusterName(e.currentTarget.value));
                        }}
                    />
                    {renderValidationMessage(clusterName)}
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
                            acrNameEditedRef.current = true;
                            setAcrName(getValidatedAcrName(e.currentTarget.value));
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

            <div className={`${styles.buttonContainer} ${styles.fullWidth}`}>
                <button type="submit">{l10n.t("Continue")}</button>
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
