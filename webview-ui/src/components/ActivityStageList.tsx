import { useState } from "react";
import * as l10n from "@vscode/l10n";
import {
    faArrowRotateRight,
    faCheckCircle,
    faChevronDown,
    faChevronRight,
    faCircle,
    faExclamationTriangle,
    faSpinner,
    faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    ActivityEntry,
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

function formatClock(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ProgressBar({ progress }: { progress: number }) {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    return (
        <span className={styles.progressRow}>
            <span className={styles.progressTrack}>
                <span className={styles.progressFill} style={{ width: `${pct}%` }} />
            </span>
            <span className={styles.progressLabel}>{`${pct}%`}</span>
        </span>
    );
}

function StageFullError({ fullError }: { fullError: string }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <span className={styles.fullError}>
            <button
                type="button"
                className={styles.fullErrorToggle}
                aria-expanded={expanded}
                onClick={() => setExpanded((prev) => !prev)}
            >
                <FontAwesomeIcon className={styles.fullErrorChevron} icon={expanded ? faChevronDown : faChevronRight} />
                {expanded ? l10n.t("Hide details") : l10n.t("More")}
            </button>
            {expanded && <span className={styles.fullErrorBody}>{fullError}</span>}
        </span>
    );
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
    return (
        <span className={styles.activityEntry}>
            <FontAwesomeIcon
                className={entryStatusClass[entry.status]}
                icon={entryStatusIcon[entry.status]}
                spin={entry.status === "running"}
            />
            {entry.url ? (
                <a className={styles.activityAction} href={entry.url} target="_blank" rel="noreferrer">
                    {entry.action}
                </a>
            ) : (
                <span className={styles.activityAction}>{entry.action}</span>
            )}
            {entry.startedAt !== undefined && (
                <span className={styles.activityStarted} title={l10n.t("Started at {0}", formatClock(entry.startedAt))}>
                    {formatClock(entry.startedAt)}
                </span>
            )}
            {entry.detail && <span className={styles.activityEntryDetail}>{entry.detail}</span>}
            {entry.code && <code className={styles.activityCode}>{entry.code}</code>}
            {entry.elapsedMs !== undefined && (
                <span className={styles.activityElapsed}>{formatElapsed(entry.elapsedMs)}</span>
            )}
            {entry.progress !== undefined && <ProgressBar progress={entry.progress} />}
        </span>
    );
}

function CollapsibleEntries({ stage }: { stage: ActivitySnapshot }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <span className={styles.entriesCollapse}>
            <button
                type="button"
                className={styles.entriesToggle}
                aria-expanded={expanded}
                onClick={() => setExpanded((prev) => !prev)}
            >
                <FontAwesomeIcon className={styles.entriesChevron} icon={expanded ? faChevronDown : faChevronRight} />
                {expanded ? l10n.t("Hide Capacity Checks") : l10n.t("Show Capacity Checks")}
            </button>
            {expanded && (
                <span className={styles.activityEntries}>
                    {stage.entries.map((entry) => (
                        <EntryRow key={entry.action} entry={entry} />
                    ))}
                </span>
            )}
        </span>
    );
}

export function ActivityStageList({
    stages,
    onRetryStage,
}: {
    stages: ActivitySnapshot[];
    onRetryStage?: (runId: number, stageId: string) => void;
}) {
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
                        {stage.fullError && <StageFullError fullError={stage.fullError} />}
                        {stage.entries.length > 0 &&
                            (stage.collapsible && stage.entries.length > 1 ? (
                                <CollapsibleEntries stage={stage} />
                            ) : (
                                <span className={styles.activityEntries}>
                                    {stage.entries.map((entry) => (
                                        <EntryRow key={entry.action} entry={entry} />
                                    ))}
                                </span>
                            ))}
                        {onRetryStage && (stage.status === "failed" || stage.status === "warning") && (
                            <button
                                type="button"
                                className={styles.stageRetry}
                                onClick={() => onRetryStage(stage.runId, stage.stage)}
                            >
                                <FontAwesomeIcon className={styles.stageRetryIcon} icon={faArrowRotateRight} />
                                {l10n.t("Retry this step")}
                            </button>
                        )}
                    </span>
                </li>
            ))}
        </ul>
    );
}
