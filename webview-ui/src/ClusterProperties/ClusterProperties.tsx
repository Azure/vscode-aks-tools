import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { ClusterDisplay } from "./ClusterDisplay";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { AgentPoolDisplay } from "./AgentPoolDisplay";
import styles from "./ClusterProperties.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRedoAlt } from "@fortawesome/free-solid-svg-icons";

export function ClusterProperties(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (isNotLoaded(state.clusterInfo)) {
            vscode.postGetPropertiesRequest();
            eventHandlers.onSetPropertiesLoading();
        }
    });

    function handleRefreshRequest() {
        vscode.postRefreshRequest();
        eventHandlers.onSetPropertiesLoading();
    }

    const clusterInfo = isLoaded(state.clusterInfo) && state.clusterInfo.value;
    return (
        <>
            <div className={styles.header}>
                <h2>
                    <span className={styles.headerTitle}>AKS Cluster Properties of {state.clusterName}</span>
                    <button
                        onClick={handleRefreshRequest}
                        className={styles.refreshButton}
                        aria-label="Refresh content"
                        title="Refresh content"
                    >
                        <FontAwesomeIcon icon={faRedoAlt} className={styles.refreshIcon} />
                    </button>
                </h2>
            </div>
            {clusterInfo ? (
                <ClusterDisplay
                    clusterInfo={clusterInfo}
                    clusterOperationRequested={state.clusterOperationRequested}
                    eventHandlers={eventHandlers}
                />
            ) : (
                <VSCodeProgressRing />
            )}

            {clusterInfo &&
                clusterInfo.agentPoolProfiles.map((ap) => (
                    <>
                        <h3>Agent Pool: {ap.name}</h3>
                        <AgentPoolDisplay
                            eventHandlers={eventHandlers}
                            clusterInfo={clusterInfo}
                            profileInfo={ap}
                            clusterOperationRequested={state.clusterOperationRequested}
                        />
                    </>
                ))}
        </>
    );
}
