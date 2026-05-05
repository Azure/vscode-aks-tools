import { Phase } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSearch,
    faCog,
    faFileCode,
    faCube,
    faRocket,
    faCheckCircle,
    faCircle,
    faSpinner,
    faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

export type PhaseProgressProps = {
    currentPhase: Phase;
    hasError: boolean;
};

const phaseConfig = [
    { phase: Phase.ANALYZE, label: "Analyze", icon: faSearch },
    { phase: Phase.CONFIGURE, label: "Configure", icon: faCog },
    { phase: Phase.PREPARE, label: "Prepare", icon: faFileCode },
    { phase: Phase.BUILD, label: "Build", icon: faCube },
    { phase: Phase.DEPLOY, label: "Deploy", icon: faRocket },
    { phase: Phase.VERIFY, label: "Verify", icon: faCheckCircle },
];

export function PhaseProgress({ currentPhase, hasError }: PhaseProgressProps) {
    const getPhaseStatus = (phase: Phase): "completed" | "current" | "pending" | "error" => {
        if (hasError && phase === currentPhase) return "error";
        if (phase < currentPhase || currentPhase === Phase.COMPLETE) return "completed";
        if (phase === currentPhase) return "current";
        return "pending";
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "completed":
                return <FontAwesomeIcon icon={faCheckCircle} className={styles.phaseIconCompleted} />;
            case "current":
                return <FontAwesomeIcon icon={faSpinner} spin className={styles.phaseIconCurrent} />;
            case "error":
                return <FontAwesomeIcon icon={faTimesCircle} className={styles.phaseIconError} />;
            default:
                return <FontAwesomeIcon icon={faCircle} className={styles.phaseIconPending} />;
        }
    };

    return (
        <div className={styles.phaseProgressContainer}>
            <div className={styles.phaseProgressTrack}>
                {phaseConfig.map((config, index) => {
                    const status = getPhaseStatus(config.phase);
                    const isLast = index === phaseConfig.length - 1;

                    return (
                        <div key={config.phase} className={styles.phaseStep}>
                            <div className={styles.phaseStepContent}>
                                <div
                                    className={`${styles.phaseIconWrapper} ${styles[`phaseStatus${status.charAt(0).toUpperCase() + status.slice(1)}`]}`}
                                >
                                    {getStatusIcon(status)}
                                </div>
                                <div className={styles.phaseLabel}>
                                    <span className={styles.phaseName}>{l10n.t(config.label)}</span>
                                </div>
                            </div>
                            {!isLast && (
                                <div
                                    className={`${styles.phaseConnector} ${status === "completed" ? styles.phaseConnectorCompleted : ""}`}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {currentPhase === Phase.COMPLETE && !hasError && (
                <div className={styles.phaseCompleteMessage}>
                    <FontAwesomeIcon icon={faCheckCircle} className={styles.phaseIconCompleted} />
                    <span>{l10n.t("Deployment complete!")}</span>
                </div>
            )}
        </div>
    );
}
