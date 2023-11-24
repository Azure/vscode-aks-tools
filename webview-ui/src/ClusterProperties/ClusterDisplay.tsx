import styles from "./ClusterProperties.module.css";
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { EventDef, vscode } from "./state";
import { EventHandlers } from "../utilities/state";

export interface ClusterDisplayProps {
    clusterInfo: ClusterInfo;
    clusterOperationRequested: boolean;
    eventHandlers: EventHandlers<EventDef>;
}

type StartStopState = "Started" | "Starting" | "Stopped" | "Stopping";

// Note: Starting and Stopping state mixed with Abort leads to weird cases where the
//       cluster is in a state that it can't be started or stopped.
const unabortableProvisioningStates = ["Canceled", "Failed", "Succeeded", "Starting", "Stopping"];

export function determineStartStopState(clusterInfo: ClusterInfo): StartStopState {
    if (
        clusterInfo.provisioningState !== "Stopping" &&
        clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerStateCode === "Stopped")
    ) {
        return "Stopped";
    } else if (
        clusterInfo.provisioningState === "Succeeded" &&
        clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerStateCode === "Running")
    ) {
        return "Started";
    } else if (clusterInfo.provisioningState === "Stopping") {
        return "Stopping";
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

    const startStopState = determineStartStopState(props.clusterInfo);
    const showAbortButton = !unabortableProvisioningStates.includes(props.clusterInfo.provisioningState);
    const showReconcileButton =
        props.clusterInfo.provisioningState === "Canceled" && props.clusterInfo.powerStateCode === "Running";

    return (
        <dl className={styles.propertyList}>
            <dt>Provisioning State</dt>
            <dd>
                {props.clusterInfo.provisioningState}
                {showAbortButton && (
                    <>
                        &nbsp;
                        <VSCodeButton
                            disabled={props.clusterOperationRequested}
                            onClick={() => handleAbortClick()}
                            appearance="secondary"
                        >
                            Abort
                        </VSCodeButton>
                    </>
                )}
                {showReconcileButton && (
                    <>
                        &nbsp;
                        <VSCodeButton
                            disabled={props.clusterOperationRequested}
                            onClick={() => handleReconcileClick()}
                            appearance="secondary"
                        >
                            Reconcile
                        </VSCodeButton>
                    </>
                )}
            </dd>

            <dt>Power State</dt>
            <dd className={styles.inlineButtonContainer}>
                {props.clusterInfo.powerStateCode}
                &nbsp;
                <span className={styles.tooltip}>
                    <span>
                        <FontAwesomeIcon icon={faInfoCircle} className={styles.infoIndicator} />
                    </span>
                    <span className={styles.tooltiptext}>
                        It is important that you don&#39;t repeatedly start/stop your cluster. Repeatedly
                        starting/stopping your cluster may result in errors. Once your cluster is stopped, you should
                        wait 15-30 minutes before starting it up again. &nbsp;
                        <VSCodeLink href="https://docs.microsoft.com/en-au/azure/aks/start-stop-cluster?tabs=azure-cli#start-an-aks-cluster">
                            Learn more
                        </VSCodeLink>
                    </span>
                </span>
                {startStopState === "Started" && (
                    <VSCodeButton
                        disabled={props.clusterOperationRequested}
                        onClick={handleStopCluster}
                        className={styles.controlButton}
                        appearance="secondary"
                    >
                        Stop Cluster
                    </VSCodeButton>
                )}
                {startStopState === "Stopped" && (
                    <VSCodeButton
                        disabled={props.clusterOperationRequested}
                        onClick={handleStartCluster}
                        className={styles.controlButton}
                        appearance="secondary"
                    >
                        Start Cluster
                    </VSCodeButton>
                )}
                {(startStopState === "Starting" || startStopState === "Stopping") &&
                    `Cluster is in ${startStopState} state`}
            </dd>

            <dt>FQDN</dt>
            <dd>{props.clusterInfo.fqdn}</dd>
            <dt>Kubernetes Version</dt>
            <dd>{props.clusterInfo.kubernetesVersion}</dd>
        </dl>
    );
}
