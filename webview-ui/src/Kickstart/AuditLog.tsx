import { useState } from "react";
import { CommandLogEntry, Phase } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faChevronDown,
    faChevronRight,
    faTerminal,
    faCheckCircle,
    faTimesCircle,
    faClock,
} from "@fortawesome/free-solid-svg-icons";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

export type AuditLogProps = {
    auditLog?: CommandLogEntry[];
};

const phaseNames: Record<Phase, string> = {
    [Phase.ANALYZE]: "Analyze",
    [Phase.CONFIGURE]: "Configure",
    [Phase.PREPARE]: "Prepare",
    [Phase.BUILD]: "Build",
    [Phase.DEPLOY]: "Deploy",
    [Phase.VERIFY]: "Verify",
    [Phase.COMPLETE]: "Complete",
};

export function AuditLog({ auditLog }: AuditLogProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());

    if (!auditLog || auditLog.length === 0) {
        return null;
    }

    const toggleEntryExpanded = (index: number) => {
        setExpandedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    const formatTimestamp = (timestamp: number): string => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };

    const formatDuration = (durationMs?: number): string => {
        if (!durationMs) return "-";
        if (durationMs < 1000) return `${durationMs}ms`;
        return `${(durationMs / 1000).toFixed(2)}s`;
    };

    const truncateOutput = (output: string, maxLines: number = 3): string => {
        const lines = output.split("\n");
        if (lines.length <= maxLines) return output;
        return lines.slice(0, maxLines).join("\n") + "\n...";
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader} onClick={() => setIsExpanded(!isExpanded)}>
                <FontAwesomeIcon
                    icon={isExpanded ? faChevronDown : faChevronRight}
                    className={styles.panelToggleIcon}
                />
                <FontAwesomeIcon icon={faTerminal} className={styles.panelIcon} />
                <h3 className={styles.panelTitle}>{l10n.t("Audit Log")}</h3>
                <span className={styles.panelCount}>{auditLog.length}</span>
            </div>

            {isExpanded && (
                <div className={styles.panelContent}>
                    <div className={styles.auditLogList}>
                        {auditLog.map((entry, index) => {
                            const isSuccess = entry.exitCode === 0;
                            const isEntryExpanded = expandedEntries.has(index);
                            const hasOutput = Boolean(entry.stdout || entry.stderr);

                            return (
                                <div key={index} className={styles.auditLogEntry}>
                                    <div className={styles.auditLogHeader}>
                                        <div className={styles.auditLogMeta}>
                                            <FontAwesomeIcon
                                                icon={isSuccess ? faCheckCircle : faTimesCircle}
                                                className={isSuccess ? styles.auditLogSuccess : styles.auditLogError}
                                            />
                                            <span className={styles.auditLogTimestamp}>
                                                {formatTimestamp(entry.timestamp)}
                                            </span>
                                            <span
                                                className={`${styles.phaseBadge} ${styles[`phaseBadge${phaseNames[entry.phase]}`]}`}
                                            >
                                                {phaseNames[entry.phase]}
                                            </span>
                                            {entry.durationMs !== undefined && (
                                                <span className={styles.auditLogDuration}>
                                                    <FontAwesomeIcon
                                                        icon={faClock}
                                                        className={styles.auditLogDurationIcon}
                                                    />
                                                    {formatDuration(entry.durationMs)}
                                                </span>
                                            )}
                                        </div>
                                        <code className={styles.auditLogCommand}>{entry.command}</code>
                                    </div>

                                    {hasOutput && (
                                        <div className={styles.auditLogOutputSection}>
                                            <button
                                                className={styles.auditLogToggle}
                                                onClick={() => toggleEntryExpanded(index)}
                                            >
                                                <FontAwesomeIcon
                                                    icon={isEntryExpanded ? faChevronDown : faChevronRight}
                                                    className={styles.auditLogToggleIcon}
                                                />
                                                <span>
                                                    {isEntryExpanded ? l10n.t("Hide output") : l10n.t("Show output")}
                                                </span>
                                            </button>

                                            {isEntryExpanded && (
                                                <div className={styles.auditLogOutputContainer}>
                                                    {entry.stdout && (
                                                        <div className={styles.auditLogOutput}>
                                                            <div className={styles.auditLogOutputLabel}>stdout:</div>
                                                            <pre className={styles.auditLogOutputContent}>
                                                                <code>{entry.stdout}</code>
                                                            </pre>
                                                        </div>
                                                    )}
                                                    {entry.stderr && (
                                                        <div className={styles.auditLogOutput}>
                                                            <div className={styles.auditLogOutputLabel}>stderr:</div>
                                                            <pre className={styles.auditLogOutputContent}>
                                                                <code>{entry.stderr}</code>
                                                            </pre>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
