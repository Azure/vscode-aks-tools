import * as l10n from "@vscode/l10n";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle, faTimesCircle, faQuestionCircle, faSpinner, faSync } from "@fortawesome/free-solid-svg-icons";
import { PermissionsState } from "./state";
import styles from "./Kickstart.module.css";

export type PermissionChecksProps = {
    permissions: PermissionsState;
    onRefresh: () => void;
    onAttach: () => void;
    hasSelection: boolean;
};

function StatusIcon({ status, loading }: { status?: boolean; loading: boolean }) {
    if (loading) {
        return <FontAwesomeIcon icon={faSpinner} spin />;
    }
    if (status === true) {
        return <FontAwesomeIcon icon={faCheckCircle} className={styles.permissionIconSuccess} />;
    }
    if (status === false) {
        return <FontAwesomeIcon icon={faTimesCircle} className={styles.permissionIconError} />;
    }
    return <FontAwesomeIcon icon={faQuestionCircle} className={styles.permissionIconUnknown} />;
}

export function PermissionChecks(props: PermissionChecksProps) {
    if (!props.hasSelection) {
        return null;
    }

    return (
        <fieldset className={styles.inputContainer}>
            <label className={styles.label}>{l10n.t("Permissions")}</label>
            <div className={`${styles.control} ${styles.actionItemList}`}>
                <div className={styles.permissionRow}>
                    <StatusIcon status={props.permissions.hasAcrPull} loading={props.permissions.loading} />
                    <span>{l10n.t("AcrPull role granted to cluster identity")}</span>
                </div>
                <div className={styles.permissionRow}>
                    <StatusIcon status={props.permissions.attached} loading={props.permissions.loading} />
                    <span>{l10n.t("ACR attached to cluster")}</span>
                    {props.permissions.attached === false && !props.permissions.loading && (
                        <button
                            data-testid="kickstart-attach-now-button"
                            onClick={props.onAttach}
                            className={styles.permissionAttachButton}
                        >
                            {l10n.t("Attach now")}
                        </button>
                    )}
                </div>
                <div className={styles.permissionRefreshContainer}>
                    <button
                        data-testid="kickstart-refresh-permissions-button"
                        onClick={props.onRefresh}
                        disabled={props.permissions.loading}
                        className="secondary-button"
                    >
                        <FontAwesomeIcon
                            icon={faSync}
                            spin={props.permissions.loading}
                            className={styles.permissionRefreshIcon}
                        />
                        {l10n.t("Refresh Status")}
                    </button>
                </div>
                {props.permissions.error && <div className={styles.permissionErrorText}>{props.permissions.error}</div>}
            </div>
        </fieldset>
    );
}
