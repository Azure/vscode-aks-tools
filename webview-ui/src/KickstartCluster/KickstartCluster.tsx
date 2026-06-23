import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import * as l10n from "@vscode/l10n";
import {
    InitialState,
    ProvisioningAccessPrompt,
} from "../../../src/webview-contract/webviewDefinitions/kickstartCluster";
import { ActivityStageList } from "../components/ActivityStageList";
import { ProgressRing } from "../components/ProgressRing";
import { useStateManagement } from "../utilities/state";
import { ClusterInput } from "./ClusterInput";
import { ExistingClusterInput } from "./ExistingClusterInput";
import { Stage, stateUpdater, vscode } from "./helpers/state";
import styles from "./KickstartCluster.module.css";

export function KickstartCluster(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (state.stage === Stage.Uninitialized) {
            vscode.postGetSubscriptionsRequest();
            eventHandlers.onSetLoading();
        }
    }, [state.stage, eventHandlers]);

    const handleRetryStage = (runId: number, stageId: string) => {
        eventHandlers.onRetryProvisioningStage();
        vscode.postRetryProvisioningStageRequest({ runId, stageId });
    };

    const handleBackToSetup = () => {
        eventHandlers.onBackToSetup();
        vscode.postBackToSetupRequest();
    };

    function getCompleteBody() {
        const result = state.finishResult;
        const provisionStages = state.activity.provision?.stages ?? [];
        if (result && result.succeeded) {
            return (
                <div>
                    <h2>{l10n.t("Your cluster is ready")}</h2>
                    <ActivityStageList stages={provisionStages} onRetryStage={handleRetryStage} />
                    <div className={styles.resultPanel}>
                        <p>
                            {l10n.t("Cluster")}: {result.clusterName}
                        </p>
                        {result.acrLoginServer && (
                            <p>
                                {l10n.t("Registry")}: {result.acrLoginServer}
                            </p>
                        )}
                        {result.clusterPortalUrl && (
                            <p>
                                <a href={result.clusterPortalUrl}>{l10n.t("View the cluster in the Azure portal")}</a>
                            </p>
                        )}
                    </div>
                    <div className={styles.buttonContainer}>
                        <button onClick={() => vscode.postContinueInChatRequest()}>{l10n.t("Continue in chat")}</button>
                    </div>
                </div>
            );
        }
        return (
            <div>
                <h2>{l10n.t("We couldn't finish setting up your cluster")}</h2>
                <ActivityStageList stages={provisionStages} onRetryStage={handleRetryStage} />
                <div className={styles.resultPanel}>
                    <p>
                        {state.errorMessage ??
                            l10n.t("A step failed before the cluster was ready. Review the steps above and try again.")}
                    </p>
                </div>
                <div className={styles.buttonContainer}>
                    <button
                        onClick={() => {
                            eventHandlers.onRetryProvisioning();
                            vscode.postRetryProvisioningRequest();
                        }}
                    >
                        {l10n.t("Try again")}
                    </button>
                    <button className={styles.secondaryButton} onClick={handleBackToSetup}>
                        {l10n.t("Back to setup")}
                    </button>
                    <button
                        className={styles.secondaryButton}
                        onClick={() => eventHandlers.onGoToExistingClusterSelection()}
                    >
                        {l10n.t("Use an existing cluster")}
                    </button>
                </div>
            </div>
        );
    }

    function getBody() {
        switch (state.stage) {
            case Stage.Uninitialized:
            case Stage.Loading:
                return <ProgressRing />;
            case Stage.CollectingInput:
                return (
                    <div>
                        <div className={styles.modeToggle} role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={state.mode === "createNew"}
                                className={`${styles.modeButton} ${state.mode === "createNew" ? styles.modeButtonActive : ""}`}
                                onClick={() => eventHandlers.onSetMode({ mode: "createNew" })}
                            >
                                {l10n.t("Create a new cluster")}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={state.mode === "useExisting"}
                                className={`${styles.modeButton} ${state.mode === "useExisting" ? styles.modeButtonActive : ""}`}
                                onClick={() => eventHandlers.onSetMode({ mode: "useExisting" })}
                            >
                                {l10n.t("Use an existing cluster")}
                            </button>
                        </div>
                        {state.mode === "createNew" ? (
                            <ClusterInput
                                subscriptions={state.subscriptions!}
                                locations={state.locations}
                                resourceGroups={state.resourceGroups}
                                selectedSubscriptionId={state.selectedSubscriptionId}
                                activity={state.activity}
                                scan={state.scan}
                                errorMessage={state.errorMessage}
                                preflightCanProceed={state.preflightCanProceed}
                                preflightRole={state.preflightRole}
                                preflightDeployment={state.preflightDeployment}
                                preflightGeneration={state.preflightGeneration}
                                launchContext={state.launchContext}
                                costEstimate={state.costEstimate}
                                eventHandlers={eventHandlers}
                                vscode={vscode}
                            />
                        ) : (
                            <ExistingClusterInput
                                subscriptions={state.subscriptions!}
                                selectedSubscriptionId={state.selectedSubscriptionId}
                                clusters={state.clusters}
                                selectedCluster={state.selectedCluster}
                                connectedAcrs={state.connectedAcrs}
                                detectingAcrs={state.detectingAcrs}
                                existingReadiness={state.existingReadiness}
                                existingReadinessKey={state.existingReadinessKey}
                                errorMessage={state.errorMessage}
                                eventHandlers={eventHandlers}
                                vscode={vscode}
                            />
                        )}
                    </div>
                );
            case Stage.Provisioning:
                return (
                    <div>
                        <h2>
                            {state.mode === "useExisting"
                                ? l10n.t("Setting up your container registry…")
                                : l10n.t("Creating your cluster and registry…")}
                        </h2>
                        <p>{l10n.t("This can take several minutes. You can keep this view open while we work.")}</p>
                        {state.provisioningAccess ? (
                            <ProvisioningAccessPanel
                                prompt={state.provisioningAccess}
                                onRecheck={(runId) => vscode.postRecheckProvisioningPermissionRequest({ runId })}
                            />
                        ) : null}
                        <ActivityStageList
                            stages={state.activity.provision?.stages ?? []}
                            onRetryStage={handleRetryStage}
                        />
                        <div className={styles.buttonContainer}>
                            <button className={styles.secondaryButton} onClick={handleBackToSetup}>
                                {l10n.t("Back to setup")}
                            </button>
                        </div>
                    </div>
                );
            case Stage.Complete:
                return getCompleteBody();
        }
    }

    return (
        <div className={styles.page}>
            <h1>{l10n.t("AKS Kickstart — Configure Cluster")}</h1>
            <p>{l10n.t("Set up your AKS Automatic cluster and container registry, then continue building in chat.")}</p>
            {getBody()}
        </div>
    );
}

const POLL_INTERVAL_SECONDS = 15;
const MAX_POLL_DURATION_SECONDS = 10 * 60;

type ProvisioningAccessPanelProps = {
    prompt: ProvisioningAccessPrompt;
    onRecheck: (runId: number) => void;
};

function ProvisioningAccessPanel({ prompt, onRecheck }: ProvisioningAccessPanelProps) {
    // With no activation link there is nothing for the user to click, so start polling immediately.
    const [phase, setPhase] = useState<"idle" | "polling" | "exhausted">(
        prompt.permissionActionUrl ? "idle" : "polling",
    );
    const [secondsUntilRetry, setSecondsUntilRetry] = useState(POLL_INTERVAL_SECONDS);
    const [activeRunId, setActiveRunId] = useState(prompt.runId);
    const onRecheckRef = useRef(onRecheck);

    useEffect(() => {
        onRecheckRef.current = onRecheck;
    }, [onRecheck]);

    // The extension re-posts the same prompt (same runId) on every still-blocked recheck; only reset the
    // polling lifecycle when a genuinely new attempt (different runId) arrives so the countdown survives.
    if (activeRunId !== prompt.runId) {
        setActiveRunId(prompt.runId);
        setPhase(prompt.permissionActionUrl ? "idle" : "polling");
        setSecondsUntilRetry(POLL_INTERVAL_SECONDS);
    }

    useEffect(() => {
        if (phase !== "polling") {
            return;
        }

        let secondsElapsed = 0;
        let secondsLeft = POLL_INTERVAL_SECONDS;

        const timer = window.setInterval(() => {
            secondsElapsed += 1;
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                onRecheckRef.current(prompt.runId);
                secondsLeft = POLL_INTERVAL_SECONDS;
            }
            setSecondsUntilRetry(secondsLeft);
            if (secondsElapsed >= MAX_POLL_DURATION_SECONDS) {
                setPhase("exhausted");
            }
        }, 1000);

        return () => window.clearInterval(timer);
    }, [phase, prompt.runId]);

    return (
        <div className={styles.footerWarningPanel}>
            <span className={styles.footerWarningMessage}>
                <FontAwesomeIcon className={styles.checkWarning} icon={faExclamationTriangle} />
                <span>
                    {l10n.t(
                        "Deployment is paused. You need permission to assign roles in {0} before we can create the cluster.",
                        prompt.resourceGroupName,
                    )}
                </span>
            </span>
            <span className={styles.footerWarningHint}>{prompt.detail}</span>
            {prompt.eligiblePimGrants.length > 0 ? (
                <ul className={styles.pimList}>
                    {prompt.eligiblePimGrants.map((grant) => (
                        <li key={`${grant.roleName}:${grant.scopeId}`} className={styles.footerWarningHint}>
                            {grant.roleName} — {grant.scopeDisplayName}
                        </li>
                    ))}
                </ul>
            ) : null}
            <div className={styles.footerWarningActions}>
                {prompt.permissionActionUrl ? (
                    <a
                        className={styles.footerActionLink}
                        href={prompt.permissionActionUrl}
                        onClick={() => setPhase("polling")}
                    >
                        {l10n.t("Activate your role in the Azure portal")}
                    </a>
                ) : null}
                {phase === "polling" ? (
                    <>
                        <ProgressRing />
                        <span className={styles.footerWarningHint}>
                            {l10n.t("Checking for access… retrying in {0}s", secondsUntilRetry)}
                        </span>
                    </>
                ) : null}
                {phase === "exhausted" ? (
                    <button
                        type="button"
                        className={`${styles.recheckButton} ${styles.footerActionButton}`}
                        onClick={() => setPhase("polling")}
                    >
                        {l10n.t("Continue Checking")}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
