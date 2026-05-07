import { useState } from "react";
import { ArtifactsData } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faChevronDown,
    faChevronRight,
    faFileCode,
    faExternalLinkAlt,
    faFolderOpen,
    faSave,
    faCheck,
} from "@fortawesome/free-solid-svg-icons";
import * as l10n from "@vscode/l10n";
import { vscode } from "./state";
import styles from "./Dashboard.module.css";

export type ArtifactsPanelProps = {
    artifacts?: ArtifactsData;
};

export function ArtifactsPanel({ artifacts }: ArtifactsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

    if (!artifacts || artifacts.stagedFiles.length === 0) {
        return null;
    }

    const { stagedFiles, savedToDisk } = artifacts;

    const toggleFileExpanded = (filename: string) => {
        setExpandedFiles((prev) => {
            const next = new Set(prev);
            if (next.has(filename)) {
                next.delete(filename);
            } else {
                next.add(filename);
            }
            return next;
        });
    };

    const handleOpenInEditor = (filename: string, stagedPath: string) => {
        vscode.postOpenArtifactRequest({ filename, stagedPath });
    };

    const handleSaveFile = (filename: string) => {
        vscode.postAcceptFileRequest({ filename });
    };

    const handleSaveToProject = () => {
        vscode.postAcceptAllRequest(undefined);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader} onClick={() => setIsExpanded(!isExpanded)}>
                <FontAwesomeIcon
                    icon={isExpanded ? faChevronDown : faChevronRight}
                    className={styles.panelToggleIcon}
                />
                <FontAwesomeIcon icon={faFileCode} className={styles.panelIcon} />
                <h3 className={styles.panelTitle}>{l10n.t("Generated Files")}</h3>
                <span className={styles.panelCount}>{stagedFiles.length}</span>
            </div>

            {isExpanded && (
                <div className={styles.panelContent}>
                    {!savedToDisk && (
                        <p className={styles.artifactHint}>
                            {l10n.t(
                                "Files are previewed in a temporary location. Click a file to review it, then save to your project.",
                            )}
                        </p>
                    )}

                    {stagedFiles.map((file) => {
                        const isFileExpanded = expandedFiles.has(file.filename);

                        return (
                            <div key={file.filename} className={styles.artifactItem}>
                                <div className={styles.artifactHeader}>
                                    <button
                                        className={styles.artifactToggle}
                                        onClick={() => toggleFileExpanded(file.filename)}
                                    >
                                        <FontAwesomeIcon
                                            icon={isFileExpanded ? faChevronDown : faChevronRight}
                                            className={styles.artifactToggleIcon}
                                        />
                                        <span className={styles.artifactFilename}>{file.filename}</span>
                                    </button>

                                    <div className={styles.artifactActions}>
                                        <button
                                            className={styles.artifactOpenButton}
                                            onClick={() => handleOpenInEditor(file.filename, file.stagedPath)}
                                            title={l10n.t("Open in Editor")}
                                        >
                                            <FontAwesomeIcon icon={faExternalLinkAlt} />
                                        </button>
                                        {!savedToDisk &&
                                            (file.status === "accepted" ? (
                                                <span
                                                    className={styles.artifactSavedIndicator}
                                                    title={l10n.t("Saved to project")}
                                                >
                                                    <FontAwesomeIcon icon={faCheck} />
                                                </span>
                                            ) : (
                                                <button
                                                    className={styles.artifactAcceptButton}
                                                    onClick={() => handleSaveFile(file.filename)}
                                                    title={l10n.t("Save this file to project")}
                                                >
                                                    <FontAwesomeIcon icon={faSave} />
                                                </button>
                                            ))}
                                    </div>
                                </div>

                                {isFileExpanded && (
                                    <div className={styles.artifactCodeBlock}>
                                        <pre>
                                            <code>{file.content}</code>
                                        </pre>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {!savedToDisk && (
                        <div className={styles.artifactFooter}>
                            <button className={styles.acceptAllButton} onClick={handleSaveToProject}>
                                <FontAwesomeIcon icon={faFolderOpen} />
                                <span>{l10n.t("Save to project")}</span>
                            </button>
                        </div>
                    )}

                    {savedToDisk && (
                        <div className={styles.artifactFooter}>
                            <span className={styles.savedToDiskLabel}>
                                ✅ {l10n.t("Saved to project")} ({stagedFiles.length} {l10n.t("files")})
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
