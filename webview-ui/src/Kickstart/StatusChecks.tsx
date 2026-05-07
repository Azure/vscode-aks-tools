import { useState } from "react";
import {
    ConfigData,
    AnalysisData,
    ArtifactsData,
    ImageData,
    DeploymentData,
    VerificationData,
} from "../../../src/webview-contract/webviewDefinitions/kickstart";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

interface StatusCheck {
    label: string;
    passed: boolean;
    detail?: string;
}

interface StatusChecksProps {
    config?: ConfigData;
    analysis?: AnalysisData;
    artifacts?: ArtifactsData;
    image?: ImageData;
    deployment?: DeploymentData;
    verification?: VerificationData;
}

function buildChecks(props: StatusChecksProps): StatusCheck[] {
    const checks: StatusCheck[] = [];
    const { config, analysis, artifacts, image, deployment, verification } = props;

    if (analysis) {
        checks.push({
            label: l10n.t("Project analyzed"),
            passed: Boolean(analysis.language),
            detail: analysis.language
                ? `${analysis.language}${analysis.framework ? ` / ${analysis.framework}` : ""}`
                : undefined,
        });
    }

    if (config) {
        checks.push({
            label: l10n.t("Cluster selected"),
            passed: Boolean(config.clusterName),
            detail: config.clusterName,
        });
        checks.push({
            label: l10n.t("Registry selected"),
            passed: Boolean(config.acrName),
            detail: config.acrName,
        });
        checks.push({
            label: l10n.t("Kubeconfig access"),
            passed: config.canGetKubeconfig,
        });
        checks.push({
            label: l10n.t("ACR Pull permission"),
            passed: config.hasAcrPull,
        });
        checks.push({
            label: l10n.t("Cluster SKU"),
            passed: true,
            detail: config.clusterSku === "Automatic" ? "AKS Automatic" : "AKS Standard",
        });
    }

    if (artifacts) {
        checks.push({
            label: l10n.t("Artifacts generated"),
            passed: artifacts.stagedFiles.length > 0,
        });
        checks.push({
            label: l10n.t("Artifacts saved to disk"),
            passed: artifacts.savedToDisk,
        });
    }

    if (image) {
        checks.push({
            label: l10n.t("Image built"),
            passed: true,
            detail: `${image.repository}:${image.tag}`,
        });
    }

    if (deployment) {
        checks.push({
            label: l10n.t("Deployed"),
            passed: deployment.appliedManifests.length > 0,
            detail: `${deployment.appliedManifests.length} manifests`,
        });
    }

    if (verification) {
        checks.push({
            label: l10n.t("Pods healthy"),
            passed: verification.podsReady,
            detail: verification.serviceEndpoint,
        });
    }

    return checks;
}

export function StatusChecks(props: StatusChecksProps) {
    const checks = buildChecks(props);
    const passing = checks.filter((c) => c.passed);
    const failing = checks.filter((c) => !c.passed);
    const allPassing = failing.length === 0;
    const [expanded, setExpanded] = useState(!allPassing);

    if (checks.length === 0) return null;

    const summary = allPassing
        ? `✅ ${passing.length}/${checks.length} ${l10n.t("checks passing")}`
        : `⚠️ ${failing.length} ${l10n.t("issue")}${failing.length > 1 ? "s" : ""}`;

    return (
        <div className={styles.statusChecks} data-testid="kickstart-status-checks">
            <div
                className={styles.statusChecksHeader}
                onClick={() => setExpanded(!expanded)}
                data-testid="status-checks-toggle"
            >
                <span className={styles.panelToggleIcon}>{expanded ? "▼" : "▶"}</span>
                <span className={styles.statusChecksSummary}>{summary}</span>
            </div>
            {expanded && (
                <div className={styles.statusChecksList}>
                    {failing.map((check, i) => (
                        <div key={`fail-${i}`} className={styles.statusCheckItem}>
                            <span className={styles.statusCheckFail}>✗</span>
                            <span className={styles.statusCheckLabel}>{check.label}</span>
                            {check.detail && <span className={styles.statusCheckDetail}>{check.detail}</span>}
                        </div>
                    ))}
                    {passing.map((check, i) => (
                        <div key={`pass-${i}`} className={styles.statusCheckItem}>
                            <span className={styles.statusCheckPass}>✓</span>
                            <span className={styles.statusCheckLabel}>{check.label}</span>
                            {check.detail && <span className={styles.statusCheckDetail}>{check.detail}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
