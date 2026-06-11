import * as l10n from "@vscode/l10n";
import { ActivitySnapshot } from "../../../src/webview-contract/webviewDefinitions/kickstartShared";
import styles from "./PreflightChecklist.module.css";
import { ActivityStageList } from "./ActivityStageList";

interface PreflightChecklistProps {
    stages: ActivitySnapshot[];
    canProceed: boolean | null;
    onBack: () => void;
    onRetry: () => void;
}

export function PreflightChecklist(props: PreflightChecklistProps) {
    const running = props.canProceed === null;
    const hasFailure = props.stages.some((stage) => stage.status === "failed");

    return (
        <div>
            <h2>{l10n.t("Validating your Azure environment")}</h2>
            <p>{getHeaderMessage(running, hasFailure)}</p>
            <ActivityStageList stages={props.stages} />
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
        </div>
    );
}

function getHeaderMessage(running: boolean, hasFailure: boolean): string {
    if (running) {
        return l10n.t("Checking providers, region availability, and quota before we provision anything…");
    }
    if (hasFailure) {
        return l10n.t("We found a problem that needs your attention before continuing.");
    }
    return l10n.t("All checks passed. Continuing…");
}
