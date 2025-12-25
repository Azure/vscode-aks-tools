import styles from "./ClusterProperties.module.css";
import { AgentPoolProfileInfo, ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { EventDef, vscode } from "./state";
import { EventHandlers } from "../utilities/state";
import * as l10n from "@vscode/l10n";
export interface AgentPoolDisplayProps {
    clusterInfo: ClusterInfo;
    profileInfo: AgentPoolProfileInfo;
    eventHandlers: EventHandlers<EventDef>;
    clusterOperationRequested: boolean;
}

// Abort on anything except: Canceled, Failed, Succeeded
const terminalProvisioningStates = ["Canceled", "Failed", "Succeeded"];

export function AgentPoolDisplay(props: AgentPoolDisplayProps) {
    const isProvisioningStateFromCluster = props.clusterInfo.provisioningState === props.profileInfo.provisioningState;
    const isOperationInProgress = !terminalProvisioningStates.includes(props.profileInfo.provisioningState);
    const showAbortButton = !isProvisioningStateFromCluster && isOperationInProgress;

    function handleAbortClick(agentPoolName: string) {
        vscode.postAbortAgentPoolOperation(agentPoolName);
        props.eventHandlers.onSetClusterOperationRequested();
    }

    return (
        <dl className={styles.propertyList}>
            <dt>{l10n.t("Provisioning State")}</dt>
            <dd>
                {props.profileInfo.provisioningState}
                {showAbortButton && (
                    <>
                        &nbsp;
                        <button
                            disabled={props.clusterOperationRequested}
                            onClick={() => handleAbortClick(props.profileInfo.name)}
                            className="secondary-button"
                        >
                            {l10n.t("Abort")}
                        </button>
                    </>
                )}
            </dd>

            <dt>{l10n.t("Power State")}</dt>
            <dd>{props.profileInfo.powerStateCode}</dd>

            <dt>{l10n.t("Node Version")}</dt>
            <dd>{l10n.t(props.profileInfo.nodeImageVersion)}</dd>

            <dt>{l10n.t("O/S Disk Size")}</dt>
            <dd>{props.profileInfo.osDiskSizeGB}</dd>

            <dt>{l10n.t("VM Size")}</dt>
            <dd>{props.profileInfo.vmSize}</dd>

            <dt>{l10n.t("Node Count")}</dt>
            <dd>{props.profileInfo.count}</dd>

            <dt>{l10n.t("O/S Type")}</dt>
            <dd>{props.profileInfo.osType}</dd>
        </dl>
    );
}
