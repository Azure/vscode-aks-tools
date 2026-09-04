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

/**
 * A chevron + label button that toggles a disclosure region. Shared by every collapsible in this
 * file (stage full-error, capacity-check entries, and the preflight stage group) so the
 * button/chevron markup and aria wiring live in exactly one place.
 */
function DisclosureButton({
    expanded,
    onToggle,
    label,
    className,
}: {
    expanded: boolean;
    onToggle: () => void;
    label: string;
    className?: string;
}) {
    return (
        <button
            type="button"
            className={`${styles.disclosureToggle} ${className ?? ""}`}
            aria-expanded={expanded}
            onClick={onToggle}
        >
            <FontAwesomeIcon className={styles.disclosureChevron} icon={expanded ? faChevronDown : faChevronRight} />
            {label}
        </button>
    );
}

function StageFullError({ fullError }: { fullError: string }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <span className={styles.fullError}>
            <DisclosureButton
                expanded={expanded}
                onToggle={() => setExpanded((prev) => !prev)}
                label={expanded ? l10n.t("Hide details") : l10n.t("More")}
            />
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
            <DisclosureButton
                expanded={expanded}
                onToggle={() => setExpanded((prev) => !prev)}
                label={expanded ? l10n.t("Hide Capacity Checks") : l10n.t("Show Capacity Checks")}
            />
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
    hideEntriesWhenSucceeded = false,
}: {
    stages: ActivitySnapshot[];
    onRetryStage?: (runId: number, stageId: string) => void;
    /**
     * When true, a succeeded stage renders only its title + one-line detail, hiding the leftover
     * timing/action entries. Keeps compact check lists (e.g. preflight) from ballooning to several
     * lines per check. Failed/warning stages always show their entries so problems stay visible.
     */
    hideEntriesWhenSucceeded?: boolean;
}) {
    if (stages.length === 0) {
        return null;
    }
    return (
        <ul className={styles.checklist}>
            {stages.map((stage) => {
                const showEntries = !(hideEntriesWhenSucceeded && stage.status === "succeeded");
                return (
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
                            {showEntries &&
                                stage.entries.length > 0 &&
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
                );
            })}
        </ul>
    );
}

/**
 * A titled, collapsible wrapper around an {@link ActivityStageList}. Auto-collapses to a one-line
 * summary once every stage has succeeded; auto-expands while any stage is still running or has
 * failed/warned so problems stay visible. The user can always toggle manually, and a manual choice
 * sticks even as the underlying status changes.
 */
export function CollapsibleStageGroup({
    title,
    stages,
    onRetryStage,
}: {
    title: string;
    stages: ActivitySnapshot[];
    onRetryStage?: (runId: number, stageId: string) => void;
}) {
    const [userOverride, setUserOverride] = useState<boolean | null>(null);

    if (stages.length === 0) {
        return null;
    }

    const total = stages.length;
    const passed = stages.filter((s) => s.status === "succeeded").length;
    const hasProblem = stages.some((s) => s.status === "failed" || s.status === "warning");
    const running = stages.some((s) => s.status === "running" || s.status === "pending");
    const allPassed = passed === total;

    // Default: expanded while running or when something needs attention; collapsed once all pass.
    const defaultExpanded = running || hasProblem || !allPassed;
    const expanded = userOverride ?? defaultExpanded;

    const summary = hasProblem
        ? l10n.t("{0} of {1} checks need attention", total - passed, total)
        : running
          ? l10n.t("Running checks… {0} of {1} passed", passed, total)
          : l10n.t("{0} of {1} checks passed", passed, total);

    const summaryStatus: SetupStepStatus = hasProblem
        ? stages.some((s) => s.status === "failed")
            ? "failed"
            : "warning"
        : running
          ? "running"
          : "succeeded";

    return (
        <div className={styles.stageGroup}>
            <button
                type="button"
                className={`${styles.disclosureToggle} ${styles.stageGroupHeader}`}
                aria-expanded={expanded}
                onClick={() => setUserOverride(!expanded)}
            >
                <FontAwesomeIcon
                    className={styles.disclosureChevron}
                    icon={expanded ? faChevronDown : faChevronRight}
                />
                <span className={styles.stageGroupTitle}>{title}</span>
                <FontAwesomeIcon
                    className={statusClass[summaryStatus]}
                    icon={statusIcon[summaryStatus]}
                    spin={summaryStatus === "running"}
                />
                <span className={styles.stageGroupSummary}>{summary}</span>
            </button>
            {expanded && <ActivityStageList stages={stages} onRetryStage={onRetryStage} hideEntriesWhenSucceeded />}
        </div>
    );
}
