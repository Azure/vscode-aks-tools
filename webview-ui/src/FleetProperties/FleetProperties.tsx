import { useEffect } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/fleetProperties";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { isLoaded, isNotLoaded } from "../utilities/lazy";
// To ensure consistent formats and styles across features, it uses the same CSS file as ClusterProperties.tsx
// TODO: considering restructuring the CSS file to be more modular and reusable
import styles from "../ClusterProperties/ClusterProperties.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRedoAlt } from "@fortawesome/free-solid-svg-icons";
import { HubMode } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { ProgressRing } from "../components/ProgressRing";
import * as l10n from "@vscode/l10n";
export function FleetProperties(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    useEffect(() => {
        if (isNotLoaded(state.fleetInfo)) {
            vscode.postGetPropertiesRequest();
            eventHandlers.onSetPropertiesLoading();
        }
    });

    function handleRefreshRequest() {
        vscode.postRefreshRequest();
        eventHandlers.onSetPropertiesLoading();
    }

    const fleetInfo = isLoaded(state.fleetInfo) && state.fleetInfo.value;

    return (
        <>
            <div className={styles.header}>
                <h2>
                    <span className={styles.headerTitle}>
                        {l10n.t("AKS Fleet Properties of")} {state.fleetName}
                    </span>
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

            {fleetInfo ? (
                <dl className={styles.propertyList}>
                    <dt>{l10n.t("Resource Group")}</dt>
                    <dd>{fleetInfo.resourceGroup}</dd>
                    <dt>{l10n.t("Location")}</dt>
                    <dd>{fleetInfo.location}</dd>
                    <dt>{l10n.t("Provisioning State")}</dt>
                    <dd>{fleetInfo.provisioningState}</dd>
                    <dt>{l10n.t("Hub Cluster Mode")}</dt>
                    <dd>{fleetInfo.hubClusterMode === HubMode.Without ? "Without hub cluster" : "With hub cluster"}</dd>
                    <dt>{l10n.t("FQDN")}</dt>
                    <dd>{fleetInfo.hubClusterMode === HubMode.Without ? "N/A" : fleetInfo.fqdn}</dd>
                </dl>
            ) : (
                <>
                    <ProgressRing />
                    <h3>
                        {l10n.t(
                            "If loading takes too long, please ensure the Treeview is up-to-date by refreshing it.",
                        )}
                    </h3>
                </>
            )}
        </>
    );
}
