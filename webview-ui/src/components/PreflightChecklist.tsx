import * as l10n from "@vscode/l10n";
import { ReactNode } from "react";
import { ActivitySnapshot } from "../../../src/webview-contract/webviewDefinitions/kickstartShared";
import styles from "./PreflightChecklist.module.css";
import { ActivityStageList } from "./ActivityStageList";

interface PreflightChecklistProps {
    stages: ActivitySnapshot[];
    canProceed: boolean | null;
    onBack: () => void;
    onRetry: () => void;
    /**
     * Optional warning content (e.g. role-write or deployment-permission banners) rendered when
     * preflight finished without a hard failure but surfaced warnings the user should acknowledge.
     * When supplied alongside {@link onConfirm}, the checklist suppresses auto-advance and shows a
     * "Create anyway / Back to setup" choice.
     */
    warningContent?: ReactNode;
    /** Invoked when the user accepts warnings and chooses to proceed with provisioning. */
    onConfirm?: () => void;
}

export function PreflightChecklist(props: PreflightChecklistProps) {
    const running = props.canProceed === null;
    const hasFailure = props.stages.some((stage) => stage.status === "failed");
    const hasWarning = !running && !hasFailure && !!props.warningContent;

    return (
        <div>
            <h2>{l10n.t("Validating your Azure environment")}</h2>
            <p>{getHeaderMessage(running, hasFailure, hasWarning)}</p>
            <ActivityStageList stages={props.stages} />
            {hasWarning && <div className={styles.warningContainer}>{props.warningContent}</div>}
            {!running && hasFailure && (
                <div className={styles.buttonContainer}>
                    <button type="button" onClick={props.onRetry}>
                        {l10n.t("Try again")}
                    </button>
                    <button type="button" className={styles.secondaryButton} onClick={props.onBack}>
                        {l10n.t("Back to setup")}
                    </button>
                </div>
            )}
            {hasWarning && props.onConfirm && (
                <div className={styles.buttonContainer}>
                    <button type="button" onClick={props.onConfirm}>
                        {l10n.t("Create cluster")}
                    </button>
                    <button type="button" className={styles.secondaryButton} onClick={props.onBack}>
                        {l10n.t("Back to setup")}
                    </button>
                </div>
            )}
        </div>
    );
}

function getHeaderMessage(running: boolean, hasFailure: boolean, hasWarning: boolean): string {
    if (running) {
        return l10n.t("Checking providers, region availability, and quota before we provision anything…");
    }
    if (hasFailure) {
        return l10n.t("We found a problem that needs your attention before continuing.");
    }
    if (hasWarning) {
        return l10n.t(
            "The cluster will be created, but you'll be missing some access. Review the details below, then choose how to proceed.",
        );
    }
    return l10n.t("All checks passed. Continuing…");
}
