import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { ClusterDisplay } from "./ClusterDisplay";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
import { AgentPoolDisplay } from "./AgentPoolDisplay";
import styles from "./ClusterProperties.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRedoAlt } from "@fortawesome/free-solid-svg-icons";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";

export function ClusterProperties(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (isNotLoaded(state.clusterInfo) && !state.propertiesLoading) {
            eventHandlers.onSetPropertiesLoading();
            vscode.postGetPropertiesRequest();
        }
    });

    function handleRefreshRequest() {
        eventHandlers.onSetPropertiesLoading();
        vscode.postRefreshRequest();
    }

    const clusterInfo = isLoaded(state.clusterInfo) && state.clusterInfo.value;
    const requestInProgress = state.propertiesLoading || state.clusterOperationRequested;
    return (
        <>
            <div className={styles.header}>
                <h2>
                    <span className={styles.headerTitle}>
                        AKS {l10n.t("Cluster Properties of")} {state.clusterName}
                    </span>
                    <button
                        onClick={handleRefreshRequest}
                        disabled={requestInProgress}
                        className={styles.refreshButton}
                        aria-label={l10n.t("Refresh content")}
                        title={l10n.t("Refresh content")}
                    >
                        <FontAwesomeIcon icon={faRedoAlt} className={styles.refreshIcon} />
                    </button>
                </h2>
            </div>
            {state.errorMessage && (
                <div className={styles.errorMessage} role="alert">
                    <strong>
                        {clusterInfo
                            ? l10n.t("Unable to complete the request")
                            : l10n.t("Unable to load cluster properties")}
                    </strong>
                    <p>{state.errorMessage}</p>
                    {!clusterInfo && (
                        <button className="secondary-button" onClick={handleRefreshRequest}>
                            {l10n.t("Retry")}
                        </button>
                    )}
                </div>
            )}
            {clusterInfo ? (
                <ClusterDisplay
                    clusterInfo={clusterInfo}
                    clusterOperationRequested={requestInProgress}
                    eventHandlers={eventHandlers}
                />
            ) : state.errorMessage ? null : (
                <ProgressRing />
            )}

            {clusterInfo &&
                clusterInfo.agentPoolProfiles.map((ap) => (
                    <section key={ap.name}>
                        <h3>
                            {l10n.t("Agent Pool:")} {ap.name}
                        </h3>
                        <AgentPoolDisplay
                            eventHandlers={eventHandlers}
                            clusterInfo={clusterInfo}
                            profileInfo={ap}
                            clusterOperationRequested={requestInProgress}
                        />
                    </section>
                ))}
        </>
    );
}
