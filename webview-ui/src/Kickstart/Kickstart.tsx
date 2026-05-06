import { useEffect, useState } from "react";
import { vscode, KickstartState, DashboardData } from "./state";
import { Phase } from "../../../src/webview-contract/webviewDefinitions/kickstart";
import { PhaseProgress } from "./PhaseProgress";
import { StatusChecks } from "./StatusChecks";
import { ModulesPanel } from "./ModulesPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { ArmResourcesPanel } from "./ArmResourcesPanel";
import { AuditLog } from "./AuditLog";
import * as l10n from "@vscode/l10n";
import styles from "./Dashboard.module.css";

export function Kickstart() {
    const [state, setState] = useState<KickstartState>({});

    useEffect(() => {
        const handler = {
            getSubscriptionsResponse: () => {},
            getResourceGroupsResponse: () => {},
            getClustersResponse: () => {},
            getAcrsResponse: () => {},
            getPermissionStatusResponse: () => {},
            attachAcrResponse: () => {},
            startKickstartResponse: () => {},
            stateChanged: (args: DashboardData) => {
                setState((prev) => ({
                    ...prev,
                    dashboard: {
                        currentPhase: args.currentPhase,
                        analysis: args.analysis,
                        config: args.config,
                        artifacts: args.artifacts,
                        image: args.image,
                        deployment: args.deployment,
                        verification: args.verification,
                        lastError: args.lastError,
                        auditLog: args.auditLog,
                        armResources: args.armResources,
                    },
                }));
            },
        };

        vscode.subscribeToMessages(handler);
    }, []);

    const hasActiveSession = state.dashboard && state.dashboard.currentPhase > Phase.ANALYZE;

    return (
        <div data-testid="kickstart-root">
            <h2>🚀 {l10n.t("AKS Kickstart")}</h2>

            {!hasActiveSession ? (
                <div className={styles.waitingSection}>
                    <p>{l10n.t("Waiting for kickstart session...")}</p>
                    <p className={styles.waitingHint}>{l10n.t("Type @kickstart in the chat to get started.")}</p>
                </div>
            ) : (
                <div className={styles.sessionCard}>
                    <h3>{l10n.t("Current Session")}</h3>
                    <div className={styles.sessionMeta}>
                        {state.dashboard!.config && (
                            <>
                                <span>
                                    {l10n.t("Cluster")}: {state.dashboard!.config.clusterName}
                                </span>
                                <span>
                                    {l10n.t("Registry")}: {state.dashboard!.config.acrName}
                                </span>
                                <span>
                                    {l10n.t("SKU")}:{" "}
                                    {state.dashboard!.config.clusterSku === "Automatic" ? "AKS Automatic" : "Standard"}
                                </span>
                            </>
                        )}
                        {state.dashboard!.image && (
                            <span>
                                {l10n.t("Image")}: {state.dashboard!.image.repository}:{state.dashboard!.image.tag}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {state.dashboard && (
                <div className={styles.dashboardContainer}>
                    <PhaseProgress
                        currentPhase={state.dashboard.currentPhase}
                        hasError={Boolean(state.dashboard.lastError)}
                    />

                    <StatusChecks
                        config={state.dashboard.config}
                        analysis={state.dashboard.analysis}
                        artifacts={state.dashboard.artifacts}
                        image={state.dashboard.image}
                        deployment={state.dashboard.deployment}
                        verification={state.dashboard.verification}
                    />

                    {state.dashboard.lastError && (
                        <div className={styles.errorBanner}>
                            <div className={styles.errorBannerHeader}>
                                <span>⚠️ {l10n.t("Error")}</span>
                            </div>
                            <div className={styles.errorBannerMessage}>{state.dashboard.lastError.message}</div>
                            <div className={styles.errorBannerMeta}>
                                <span>
                                    {state.dashboard.lastError.retryable
                                        ? l10n.t("Retryable")
                                        : l10n.t("Non-retryable")}
                                </span>
                            </div>
                        </div>
                    )}

                    <ModulesPanel modules={state.dashboard.analysis?.modules} />
                    <ArtifactsPanel artifacts={state.dashboard.artifacts} />
                    <ArmResourcesPanel armResources={state.dashboard.armResources} />
                    <AuditLog auditLog={state.dashboard.auditLog} />
                </div>
            )}
        </div>
    );
}
