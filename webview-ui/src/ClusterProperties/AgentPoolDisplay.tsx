import styles from "./ClusterProperties.module.css";
import { AgentPoolProfileInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";

export interface AgentPoolDisplayProps {
    profileInfo: AgentPoolProfileInfo
}

export function AgentPoolDisplay(props: AgentPoolDisplayProps) {
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
        </dl>
    );
}