import styles from "./ClusterProperties.module.css";
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { EventDef, vscode } from "./state";
import { EventHandlers } from "../utilities/state";

export interface ClusterDisplayProps {
    clusterInfo: ClusterInfo
    clusterOperationRequested: boolean
    eventHandlers: EventHandlers<EventDef>
}

type StartStopState = "Started" | "Starting" | "Stopped" | "Stopping";

export function determineStartStopState(clusterInfo: ClusterInfo): StartStopState {
    if ( clusterInfo.provisioningState !== "Stopping" && clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerStateCode === "Stopped") ) {
        return "Stopped";
    } else if ( clusterInfo.provisioningState === "Succeeded" && clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerStateCode === "Running") ) {
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

    const startStopState = determineStartStopState(props.clusterInfo);
    return (
        <dl className={styles.propertyList}>
            <dt>Provisioning State</dt>
            <dd>{props.clusterInfo.provisioningState}</dd>

            <dt>FQDN</dt><dd>{props.clusterInfo.fqdn}</dd>
            <dt>Kubernetes Version</dt><dd>{props.clusterInfo.kubernetesVersion}</dd>

            <dt>Power State</dt>
            <dd className={styles.inlineButtonContainer}>
                {props.clusterInfo.powerStateCode}
                &nbsp;

                <span className={styles.tooltip}>
                    <span>
                        <FontAwesomeIcon icon={faInfoCircle} className={styles.infoIndicator} />
                    </span>
                    <span className={styles.tooltiptext}>
                        It is important that you don't repeatedly start/stop your cluster.
                        Repeatedly starting/stopping your cluster may result in errors.
                        Once your cluster is stopped, you should wait 15-30 minutes before starting it up again.
                        &nbsp;
                        <VSCodeLink href="https://docs.microsoft.com/en-au/azure/aks/start-stop-cluster?tabs=azure-cli#start-an-aks-cluster">Learn more</VSCodeLink>
                    </span>
                </span>

                {startStopState === "Started" && <VSCodeButton disabled={props.clusterOperationRequested} onClick={handleStopCluster}>Stop Cluster</VSCodeButton>}
                {startStopState === "Stopped" && <VSCodeButton disabled={props.clusterOperationRequested} onClick={handleStartCluster}>Start Cluster</VSCodeButton>}
                {(startStopState === "Starting" || startStopState === "Stopping") && `Cluster is in ${startStopState} state`}
            </dd>
        </dl>
     );
}