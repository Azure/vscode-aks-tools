import { useState } from "react";
import { ArtifactsData } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faFileCode, faExternalLinkAlt } from "@fortawesome/free-solid-svg-icons";
import * as l10n from "@vscode/l10n";
import { vscode } from "./state";
import styles from "./Dashboard.module.css";

export type ArtifactsPanelProps = {
    artifacts?: ArtifactsData;
};

type ArtifactFile = {
    filename: string;
    content: string;
    language: string;
};

export function ArtifactsPanel({ artifacts }: ArtifactsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

    if (!artifacts) {
        return null;
    }

    const files: ArtifactFile[] = [];

    if (artifacts.dockerfile) {
        files.push({ filename: "Dockerfile", content: artifacts.dockerfile, language: "dockerfile" });
    }

    if (artifacts.manifests) {
        artifacts.manifests.forEach((manifest) => {
            files.push({ filename: manifest.filename, content: manifest.content, language: "yaml" });
        });
    }

    if (artifacts.workflowYaml) {
        files.push({ filename: ".github/workflows/deploy.yml", content: artifacts.workflowYaml, language: "yaml" });
    }

    if (files.length === 0) {
        return null;
    }

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

    const handleOpenInEditor = (filename: string, content: string) => {
        vscode.postOpenArtifactRequest({ filename, content });
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader} onClick={() => setIsExpanded(!isExpanded)}>
                <FontAwesomeIcon
                    icon={isExpanded ? faChevronDown : faChevronRight}
                    className={styles.panelToggleIcon}
                />
                <FontAwesomeIcon icon={faFileCode} className={styles.panelIcon} />
                <h3 className={styles.panelTitle}>{l10n.t("Generated Artifacts")}</h3>
                <span className={styles.panelCount}>{files.length}</span>
            </div>

            {isExpanded && (
                <div className={styles.panelContent}>
                    {files.map((file) => {
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
                                    <button
                                        className={styles.artifactOpenButton}
                                        onClick={() => handleOpenInEditor(file.filename, file.content)}
                                        title={l10n.t("Open in Editor")}
                                    >
                                        <FontAwesomeIcon icon={faExternalLinkAlt} />
                                        <span>{l10n.t("Open in Editor")}</span>
                                    </button>
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
                </div>
            )}
        </div>
    );
}
