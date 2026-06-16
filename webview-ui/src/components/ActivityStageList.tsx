import {
    faCheckCircle,
    faCircle,
    faExclamationTriangle,
    faSpinner,
    faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    ActivitySnapshot,
    ActivityStatus,
    SetupStepStatus,
} from "../../../src/webview-contract/webviewDefinitions/kickstartShared";
import styles from "./ActivityStageList.module.css";

export const statusIcon: Record<SetupStepStatus, typeof faCircle> = {
    pending: faCircle,
    running: faSpinner,
    succeeded: faCheckCircle,
    warning: faExclamationTriangle,
    failed: faTimesCircle,
};

export const statusClass: Record<SetupStepStatus, string> = {
    pending: styles.checkPending,
    running: styles.checkRunning,
    succeeded: styles.checkSucceeded,
    warning: styles.checkWarning,
    failed: styles.checkFailed,
};

const entryStatusIcon: Record<ActivityStatus, typeof faCircle> = {
    running: faSpinner,
    succeeded: faCheckCircle,
    warning: faExclamationTriangle,
    failed: faTimesCircle,
    cancelled: faCircle,
};

const entryStatusClass: Record<ActivityStatus, string> = {
    running: styles.checkRunning,
    succeeded: styles.checkSucceeded,
    warning: styles.checkWarning,
    failed: styles.checkFailed,
    cancelled: styles.checkPending,
};

export function formatElapsed(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function ActivityStageList({ stages }: { stages: ActivitySnapshot[] }) {
    if (stages.length === 0) {
        return null;
    }
    return (
        <ul className={styles.checklist}>
            {stages.map((stage) => (
                <li key={stage.stage} className={styles.checkItem}>
                    <FontAwesomeIcon
                        className={statusClass[stage.status]}
                        icon={statusIcon[stage.status]}
                        spin={stage.status === "running"}
                    />
                    <span className={styles.checkBody}>
                        <span className={styles.checkTitle}>{stage.title}</span>
                        {stage.detail && <span className={styles.checkDetail}>{stage.detail}</span>}
                        {stage.entries.length > 0 && (
                            <span className={styles.activityEntries}>
                                {stage.entries.map((entry) => (
                                    <span key={entry.action} className={styles.activityEntry}>
                                        <FontAwesomeIcon
                                            className={entryStatusClass[entry.status]}
                                            icon={entryStatusIcon[entry.status]}
                                            spin={entry.status === "running"}
                                        />
                                        {entry.url ? (
                                            <a
                                                className={styles.activityAction}
                                                href={entry.url}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {entry.action}
                                            </a>
                                        ) : (
                                            <span className={styles.activityAction}>{entry.action}</span>
                                        )}
                                        {entry.detail && (
                                            <span className={styles.activityEntryDetail}>{entry.detail}</span>
                                        )}
                                        {entry.elapsedMs !== undefined && (
                                            <span className={styles.activityElapsed}>
                                                {formatElapsed(entry.elapsedMs)}
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </span>
                        )}
                    </span>
                </li>
            ))}
        </ul>
    );
}
