import styles from "./ClusterProperties.module.css";
import { AgentPoolProfileInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { EventDef, vscode } from "./state";
import { EventHandlers } from "../utilities/state";

export interface AgentPoolDisplayProps {
    profileInfo: AgentPoolProfileInfo;
    eventHandlers: EventHandlers<EventDef>;
    clusterOperationRequested: boolean;
}

// Abort on anything except: Canceled, Failed, Succeeded
// Check about deleting
type ProvisionState = "CapturingSecurityVHDSnapshot" | "Creating" | "Deleting" | "RefreshingServicePrincipalProfile"
                    | "RotatingClusterCertificates" | "Scaling" | "Starting" | "Stopping" | "Succeeded" | "Updating" 
                    | "Upgrading" | "UpgradingNodeImageVersion";

export function AgentPoolDisplay(props: AgentPoolDisplayProps) {
    const showAbortButton = !["Canceled", "Failed", "Succeeded"].includes(props.profileInfo.provisioningState);

    function handleAbortClick(agentPoolName: string) {
        vscode.postAbortAgentPoolOperation(agentPoolName);
        props.eventHandlers.onSetClusterOperationRequested();
    }

    return (
        <dl className={styles.propertyList}>
            <dt>Provisioning State</dt>
            <dd>
                {props.profileInfo.provisioningState}
                {showAbortButton &&
                <>
                    &nbsp;
                    <VSCodeButton disabled={props.clusterOperationRequested} onClick={() => handleAbortClick(props.profileInfo.name)}>Abort</VSCodeButton>
                </>
                }
            </dd>

            <dt>Power State</dt>
            <dd>{props.profileInfo.powerStateCode}</dd>

            <dt>Node Version</dt>
            <dd>{props.profileInfo.nodeImageVersion}</dd>

            <dt>O/S Disk Size</dt>
            <dd>{props.profileInfo.osDiskSizeGB}</dd>

            <dt>VM Size</dt>
            <dd>{props.profileInfo.vmSize}</dd>

            <dt>Node Count</dt>
            <dd>{props.profileInfo.count}</dd>

            <dt>O/S Type</dt>
            <dd>{props.profileInfo.osType}</dd>
        </dl>
    );
}