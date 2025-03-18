import { useState } from "react";
import { ClusterInfo } from "../../../src/webview-contract/webviewDefinitions/clusterProperties";
import styles from "./ClusterProperties.module.css";
import { vscode } from "./state";
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";

export interface ClusterUpgradeProps {
    clusterInfo: ClusterInfo;
    clusterOperationRequested: boolean;
    onUpgrade: (version: string) => void;
}

export function ClusterUpgrade(props: ClusterUpgradeProps) {
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const isUpgrading = props.clusterInfo.provisioningState === "Upgrading";

    function handleUpgradeVersionChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        const version = target.value;

        if (version && version !== "Select version") {
            setSelectedVersion(version);
            setShowConfirmation(true);
        }
    }

    function handleConfirmUpgrade() {
        if (selectedVersion) {
            // Set clusterOperationRequested first so UI updates immediately
            props.onUpgrade(selectedVersion);

            // Then post the request to the extension
            vscode.postUpgradeClusterVersionRequest(selectedVersion);
            setShowConfirmation(false);
            resetDropdown();
        }
    }

    function handleCancelUpgrade() {
        setShowConfirmation(false);
        setSelectedVersion(null);
        resetDropdown();
    }

    function resetDropdown() {
        setSelectedVersion(null);
    }

    // Only render if upgrade versions are available
    if (!props.clusterInfo.availableUpgradeVersions?.length) return null;

    const warningMessage = (
        <div>
            <p>
                You are about to upgrade your AKS cluster from version{" "}
                <strong>{props.clusterInfo.kubernetesVersion}</strong> to <strong>{selectedVersion}</strong>.
            </p>
            <FontAwesomeIcon icon={faExclamationTriangle} className={styles.warningIcon} />
            An AKS cluster upgrade triggers a cordon and drain of your nodes. If you have a low compute quota available,
            the upgrade might fail. For more information, see{" "}
            <a
                href="https://learn.microsoft.com/en-us/azure/quotas/regional-quota-requests"
                target="_blank"
                rel="noopener noreferrer"
            >
                increase quotas
            </a>
            .<p>Are you sure you want to proceed with the upgrade?</p>
        </div>
    );

    // Show default (empty) value when upgrading is in progress
    const displayVersion = isUpgrading || props.clusterOperationRequested ? "" : selectedVersion;
    const readyToUpgrade =
        props.clusterInfo.powerStateCode === "Running" && props.clusterInfo.provisioningState === "Succeeded";

    return (
        <>
            <div className={styles.upgradeVersionDropdown} style={{ marginLeft: "10px" }}>
                <span>Upgrade:</span>
                <VSCodeDropdown
                    onchange={handleUpgradeVersionChange}
                    disabled={props.clusterOperationRequested || !readyToUpgrade}
                    style={{ minWidth: "120px", maxWidth: "150px" }}
                    value={displayVersion || ""}
                >
                    <VSCodeOption selected={!displayVersion} value="">
                        Select version
                    </VSCodeOption>
                    {props.clusterInfo.availableUpgradeVersions.map((version: string) => (
                        <VSCodeOption key={version} value={version} selected={version === displayVersion}>
                            {version}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>
            <ConfirmationDialog
                title="Confirm Kubernetes Version Upgrade"
                message={warningMessage}
                confirmLabel="Upgrade"
                cancelLabel="Cancel"
                isOpen={showConfirmation}
                onConfirm={handleConfirmUpgrade}
                onCancel={handleCancelUpgrade}
            />
        </>
    );
}
