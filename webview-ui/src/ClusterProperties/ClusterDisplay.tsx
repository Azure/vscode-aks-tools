import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { EventHandlers } from "../utilities/state";
import styles from "./ClusterProperties.module.css";
import { EventDef, vscode } from "./state";
import { ClusterDisplayToolTip } from "./ClusterDisplayToolTip";

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

    const supportedPatchVersions = props.clusterInfo.supportedVersions.flatMap((v) => v.patchVersions);
    const isSupported = supportedPatchVersions.includes(props.clusterInfo.kubernetesVersion);

    return (
        <dl className={styles.propertyList}>
            <dt>Provisioning State</dt>
            <dd>
                {props.clusterInfo.provisioningState}
                <div className={styles.buttonDiv}>
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
                </div>
            </dd>

            <dt>Power State</dt>
            <dd>
                {props.clusterInfo.powerStateCode}
                &nbsp;
                <span className={styles.tooltip}>
                    <span className={styles.infoIndicator}>
                        <div className="icon">
                            <i className="codicon codicon-info"></i>
                        </div>
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
                <div className={styles.buttonDiv}>
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
                    {(startStopState === "Starting" || startStopState === "Stopping") && (
                        <span>{`Cluster is in ${startStopState} state`}</span>
                    )}
                </div>
            </dd>

            <dt>FQDN</dt>
            <dd>{props.clusterInfo.fqdn}</dd>
            <dt>Kubernetes Version</dt>
            <dd>
                {props.clusterInfo.kubernetesVersion} {isSupported ? "" : "(Out of support)"}
                &nbsp;
                <ClusterDisplayToolTip clusterInfo={props.clusterInfo}></ClusterDisplayToolTip>
            </dd>
        </dl>
    );
}
