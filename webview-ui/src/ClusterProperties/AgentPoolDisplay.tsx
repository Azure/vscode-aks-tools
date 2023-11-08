import styles from "./ClusterProperties.module.css";
import { AgentPoolProfileInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

export interface AgentPoolDisplayProps {
    profileInfo: AgentPoolProfileInfo
}

// Abort on anything except: Canceled, Failed, Succeeded
// Check about deleting
type ProvisionState = "CapturingSecurityVHDSnapshot" | "Creating" | "Deleting" | "RefreshingServicePrincipalProfile"
                    | "RotatingClusterCertificates" | "Scaling" | "Starting" | "Stopping" | "Succeeded" | "Updating" 
                    | "Upgrading" | "UpgradingNodeImageVersion";

export function determineAbortNodeAgentAllowed(agenInfo: AgentPoolProfileInfo): ProvisionState | undefined {
    if (["Canceled", "Failed", "Succeeded"].includes(agenInfo.provisioningState)) {
        return undefined;
    } else {
        return agenInfo.provisioningState as ProvisionState;
    }
}

export function AgentPoolDisplay(props: AgentPoolDisplayProps) {
    const determineAbortNodeAgentButton = determineAbortNodeAgentAllowed(props.profileInfo);

    return (
        <dl className={styles.propertyList}>
            <dt>Node Version</dt>
            <dd>{props.profileInfo.nodeImageVersion}</dd>

            <dt>O/S Disk Size</dt>
            <dd>{props.profileInfo.osDiskSizeGB}</dd>

            <dt>Provision State</dt>
            <dd>{props.profileInfo.provisioningState}</dd>

            <dt>VM Size</dt>
            <dd>{props.profileInfo.vmSize}</dd>

            <dt>Node Count</dt>
            <dd>{props.profileInfo.count}</dd>

            <dt>O/S Type</dt>
            <dd>{props.profileInfo.osType}</dd>

            <dt>
              {determineAbortNodeAgentButton &&  <VSCodeButton>Abort Last Operation on Agent Pool name {props.profileInfo.name}</VSCodeButton>}
            </dt>
        </dl>
    );
}