import { VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { useEffect } from "react";
import { PeriscopeTypes } from "../../../src/webview-contract/webviewTypes";
import { NodeActions } from "./NodeActions";
import { NodeLogs } from "./NodeLogs";
import styles from "./Periscope.module.css";

export interface SuccessViewProps {
    runId: string
    clusterName: string
    uploadStatuses: PeriscopeTypes.NodeUploadStatus[]
    onRequestUploadStatusCheck: () => void
    onNodeClick: (node: string) => void
    selectedNode: string
    nodePodLogs: PeriscopeTypes.PodLogs[] | null
    containerUrl: string
    shareableSas: string
}

export function SuccessView(props: SuccessViewProps) {
    // Once
    useEffect(() => {
        const interval = setInterval(props.onRequestUploadStatusCheck, 10 * 1000);
        return () => clearInterval(interval);
    }, []);

    function getNodeRowClassNames(nodeName: string): string {
        return [props.selectedNode === nodeName && styles.selected].filter(s => s).join(' ');
    }

    return (
        <>
            <p>
                <i className={["fa", "status-icon", "fa-check-circle", styles.successIndicator].join(" ")}></i>
                AKS Periscope has successfully started run <b>{props.runId}</b> on cluster <b>{props.clusterName}</b>
            </p>

            <table className={styles.nodelist}>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Node Name</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {
                        props.uploadStatuses.map(status => (
                            <tr key={status.nodeName} onClick={() => props.onNodeClick(status.nodeName)} className={getNodeRowClassNames(status.nodeName)}>
                                <td>{status.isUploaded ? <><i className={["fa", "fa-check-circle", styles.successIndicator].join(" ")}></i>Uploaded</> : <VSCodeProgressRing />}</td>
                                <td>{status.nodeName}</td>
                                <td className={styles.actionsContainer}>
                                    <NodeActions
                                        runId={props.runId}
                                        nodeName={status.nodeName}
                                        containerUrl={props.containerUrl}
                                        shareableSas={props.shareableSas}
                                        isUploaded={status.isUploaded}
                                    />
                                </td>
                            </tr>
                        ))
                    }
                </tbody>
            </table>

            <VSCodeDivider />

            {props.selectedNode && props.nodePodLogs && <NodeLogs node={props.selectedNode} podLogs={props.nodePodLogs} />}
        </>
    );
}