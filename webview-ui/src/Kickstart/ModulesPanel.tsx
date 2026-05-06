import { useState } from "react";
import { ModuleInfo } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

interface ModulesPanelProps {
    modules?: ModuleInfo[];
}

function getLanguageIcon(language?: string): string {
    switch (language?.toLowerCase()) {
        case "javascript":
        case "typescript":
            return "📦";
        case "python":
            return "🐍";
        case "go":
            return "🔷";
        case "java":
            return "☕";
        case "dotnet":
        case "csharp":
            return "🟣";
        case "rust":
            return "🦀";
        default:
            return "📄";
    }
}

export function ModulesPanel({ modules }: ModulesPanelProps) {
    const [isOpen, setIsOpen] = useState(true);

    if (!modules || modules.length === 0) {
        return null;
    }

    return (
        <div className={styles.panel} data-testid="kickstart-modules-panel">
            <div className={styles.panelHeader} onClick={() => setIsOpen(!isOpen)} data-testid="modules-panel-toggle">
                <span className={styles.panelToggleIcon}>{isOpen ? "▼" : "▶"}</span>
                <span className={styles.panelIcon}>🔍</span>
                <h4 className={styles.panelTitle}>{l10n.t("Detected Apps")}</h4>
                <span className={styles.panelCount}>{modules.length}</span>
            </div>
            {isOpen && (
                <div className={styles.panelContent}>
                    <table className={styles.resourceTable} data-testid="modules-table">
                        <thead>
                            <tr>
                                <th>{l10n.t("Name")}</th>
                                <th>{l10n.t("Language")}</th>
                                <th>{l10n.t("Framework")}</th>
                                <th>{l10n.t("Path")}</th>
                                <th>{l10n.t("Port")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {modules.map((mod, i) => (
                                <tr key={i}>
                                    <td className={styles.resourceName}>
                                        {getLanguageIcon(mod.language)} {mod.name || "—"}
                                    </td>
                                    <td>{mod.language || "—"}</td>
                                    <td>{mod.framework || "—"}</td>
                                    <td className={styles.resourceType}>{mod.modulePath || "."}</td>
                                    <td>{mod.port ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
