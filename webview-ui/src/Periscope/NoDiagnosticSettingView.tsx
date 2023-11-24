import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import styles from "./Periscope.module.css";

export interface NoDiagnosticSettingViewProps {
    clusterName: string;
}

export function NoDiagnosticSettingView(props: NoDiagnosticSettingViewProps) {
    return (
        <>
            <div className="critical">
                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                We didn’t find any storage account associated with `{props.clusterName}`. Please use the Diagnostics
                settings in the Azure Portal to configure a storage account for your cluster and try again.
            </div>
        </>
    );
}
