import * as l10n from "@vscode/l10n";
import styles from "./Kickstart.module.css";

export type ActionBarProps = {
    canStart: boolean;
    onStart: () => void;
    onCancel: () => void;
};

export function ActionBar(props: ActionBarProps) {
    return (
        <div className={styles.actionBar}>
            <button data-testid="kickstart-start-button" onClick={props.onStart} disabled={!props.canStart}>
                {l10n.t("Start Kickstart")}
            </button>
            <button data-testid="kickstart-cancel-button" className="secondary-button" onClick={props.onCancel}>
                {l10n.t("Cancel")}
            </button>
        </div>
    );
}
