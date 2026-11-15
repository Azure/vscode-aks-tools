import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { EventHandlers } from "../utilities/state";
import styles from "./ClusterProperties.module.css";
import { EventDef, vscode } from "./state";
import { ClusterDisplayToolTip } from "./ClusterDisplayToolTip";
import { ClusterUpgrade } from "./ClusterUpgrade";
import * as l10n from "@vscode/l10n";
export interface ClusterDisplayProps {
    clusterInfo: ClusterInfo;
    clusterOperationRequested: boolean;
    eventHandlers: EventHandlers<EventDef>;
}

type StartStopState = "Started" | "Starting" | "Stopped" | "Stopping";

// Note: Starting and Stopping state mixed with Abort leads to weird cases where the
//       cluster is in a state that it can't be started or stopped.
const unabortableProvisioningStates = ["Canceled", "Failed", "Succeeded", "Starting", "Stopping"];

function displayValue(value: string): string {
    return value === "Unknown" ? l10n.t("Unknown") : value;
}

export function determineStartStopState(clusterInfo: ClusterInfo): StartStopState {
    const hasAgentPools = clusterInfo.agentPoolProfiles.length > 0;
    const allAgentPoolsStopped =
        hasAgentPools && clusterInfo.agentPoolProfiles.every((nodePool) => nodePool.powerStateCode === "Stopped");
    const allAgentPoolsRunning =
        hasAgentPools && clusterInfo.agentPoolProfiles.every((nodePool) => nodePool.powerStateCode === "Running");
    if (clusterInfo.provisioningState === "Stopping") {
        return "Stopping";
    } else if (
        clusterInfo.powerStateCode === "Stopped" ||
        clusterInfo.powerStateCode === "Deallocated" ||
        allAgentPoolsStopped
    ) {
        return "Stopped";
    } else if (
        clusterInfo.provisioningState === "Succeeded" &&
        (clusterInfo.powerStateCode === "Running" || allAgentPoolsRunning)
    ) {
        return "Started";
    } else {
        return "Starting";
    }
}

export function ClusterDisplay(props: ClusterDisplayProps) {
    function handleStopCluster() {
        vscode.postStopClusterRequest();
        props.eventHandlers.onSetClusterOperationRequested();
    }

    function handleStartCluster() {
        vscode.postStartClusterRequest();
        props.eventHandlers.onSetClusterOperationRequested();
    }

    function handleAbortClick() {
        vscode.postAbortClusterOperation();
        props.eventHandlers.onSetClusterOperationRequested();
    }

    function handleReconcileClick() {
        vscode.postReconcileClusterRequest();
        props.eventHandlers.onSetClusterOperationRequested();
    }

    function handleUpgradeVersion(version: string) {
        // Update UI state immediately to show upgrading state
        props.eventHandlers.onUpgradeVersionSelected(version);
        props.eventHandlers.onSetClusterOperationRequested();
    }

    const startStopState = determineStartStopState(props.clusterInfo);
    const showAbortButton =
        props.clusterInfo.provisioningState !== "Unknown" &&
        !unabortableProvisioningStates.includes(props.clusterInfo.provisioningState);
    const showReconcileButton =
        props.clusterInfo.provisioningState === "Canceled" && props.clusterInfo.powerStateCode === "Running";

    const supportedPatchVersions = props.clusterInfo.supportedVersions.flatMap((v) => v.patchVersions);
    const isSupported = supportedPatchVersions.includes(props.clusterInfo.kubernetesVersion);
    const hasSupportInformation = props.clusterInfo.supportedVersions.length > 0;

    const isUpgrading = props.clusterInfo.provisioningState.toLowerCase() === "upgrading";

    return (
        <dl className={styles.propertyList}>
            <dt>{l10n.t("Provisioning State")}</dt>
            <dd>
                {displayValue(props.clusterInfo.provisioningState)}
                <div className={styles.buttonDiv}>
                    {showAbortButton && (
                        <>
                            &nbsp;
                            <button
                                disabled={props.clusterOperationRequested}
                                onClick={() => handleAbortClick()}
                                className="secondary-button"
                            >
                                {l10n.t("Abort")}
                            </button>
                        </>
                    )}
                    {showReconcileButton && (
                        <>
                            &nbsp;
                            <button
                                disabled={props.clusterOperationRequested}
                                onClick={() => handleReconcileClick()}
                                className="secondary-button"
                            >
                                {l10n.t("Reconcile")}
                            </button>
                        </>
                    )}
                </div>
            </dd>

            <dt>Power State</dt>
            <dd>
                {displayValue(props.clusterInfo.powerStateCode)}
                &nbsp;
                <span className={styles.tooltip}>
                    <span className={styles.infoIndicator}>
                        <div className="icon">
                            <i className="codicon codicon-info"></i>
                        </div>
                    </span>
                    <span className={styles.tooltiptext}>
                        {l10n.t(
                            "It is important that you don't repeatedly start/stop your cluster. Repeatedly starting/stopping your cluster may result in errors. Once your cluster is stopped, you should wait 15-30 minutes before starting it up again.",
                        )}{" "}
                        <a href="https://docs.microsoft.com/en-au/azure/aks/start-stop-cluster?tabs=azure-cli#start-an-aks-cluster">
                            {l10n.t("Learn more")}
                        </a>
                    </span>
                </span>
                <div className={styles.buttonDiv}>
                    {startStopState === "Started" && (
                        <button
                            disabled={props.clusterOperationRequested}
                            onClick={handleStopCluster}
                            className={`${styles.controlButton} secondary-button`}
                        >
                            {l10n.t("Stop Cluster")}
                        </button>
                    )}
                    {startStopState === "Stopped" && (
                        <button
                            disabled={props.clusterOperationRequested}
                            onClick={handleStartCluster}
                            className={`${styles.controlButton} secondary-button`}
                        >
                            {l10n.t("Start Cluster")}
                        </button>
                    )}
                    {(startStopState === "Starting" || startStopState === "Stopping") && (
                        <span>{`Cluster is in ${startStopState} state`}</span>
                    )}
                </div>
            </dd>

            <dt>FQDN</dt>
            <dd>{displayValue(props.clusterInfo.fqdn)}</dd>

            <dt>Kubernetes {l10n.t("Version")}</dt>
            <dd>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                        {displayValue(props.clusterInfo.kubernetesVersion)}{" "}
                        {hasSupportInformation && !isSupported ? l10n.t("(Out of support)") : ""}
                        {isUpgrading && <span className={styles.upgradeIndicator}>(Upgrading)</span>}
                    </span>
                    {hasSupportInformation && <ClusterDisplayToolTip clusterInfo={props.clusterInfo} />}
                    <ClusterUpgrade
                        clusterInfo={props.clusterInfo}
                        clusterOperationRequested={props.clusterOperationRequested}
                        onUpgrade={handleUpgradeVersion}
                    />
                </div>
            </dd>
        </dl>
    );
}
