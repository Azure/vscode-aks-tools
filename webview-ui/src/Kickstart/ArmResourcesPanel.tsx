import { useState } from "react";
import { ArmResource } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faCloud } from "@fortawesome/free-solid-svg-icons";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

export type ArmResourcesPanelProps = {
    armResources?: ArmResource[];
};

export function ArmResourcesPanel({ armResources }: ArmResourcesPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!armResources || armResources.length === 0) {
        return null;
    }

    const getActionBadgeClass = (action: string): string => {
        switch (action) {
            case "created":
                return styles.actionBadgeCreated;
            case "modified":
                return styles.actionBadgeModified;
            case "used":
            default:
                return styles.actionBadgeUsed;
        }
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader} onClick={() => setIsExpanded(!isExpanded)}>
                <FontAwesomeIcon
                    icon={isExpanded ? faChevronDown : faChevronRight}
                    className={styles.panelToggleIcon}
                />
                <FontAwesomeIcon icon={faCloud} className={styles.panelIcon} />
                <h3 className={styles.panelTitle}>{l10n.t("Azure Resources")}</h3>
                <span className={styles.panelCount}>{armResources.length}</span>
            </div>

            {isExpanded && (
                <div className={styles.panelContent}>
                    <table className={styles.resourceTable}>
                        <thead>
                            <tr>
                                <th>{l10n.t("Type")}</th>
                                <th>{l10n.t("Name")}</th>
                                <th>{l10n.t("Resource Group")}</th>
                                <th>{l10n.t("Action")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {armResources.map((resource, index) => (
                                <tr key={index}>
                                    <td className={styles.resourceType}>{resource.type}</td>
                                    <td className={styles.resourceName}>{resource.name}</td>
                                    <td className={styles.resourceGroup}>{resource.resourceGroup}</td>
                                    <td>
                                        <span
                                            className={`${styles.actionBadge} ${getActionBadgeClass(resource.action)}`}
                                        >
                                            {resource.action}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
