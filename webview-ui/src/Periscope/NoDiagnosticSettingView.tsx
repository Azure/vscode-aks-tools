import styles from "./Periscope.module.css";

export interface NoDiagnosticSettingViewProps {
    clusterName: string
}

export function NoDiagnosticSettingView(props: NoDiagnosticSettingViewProps) {
    return (
        <>
            <div className="critical">
                <i className={[styles.errorIndicator, "fa", "fa-times-circle"].join(" ")}></i>
                We didn’t find any storage account associated with `{props.clusterName}`. Please use the Diagnostics settings in the Azure Portal to configure
                a storage account for your cluster and try again.
            </div>
        </>
    )
}