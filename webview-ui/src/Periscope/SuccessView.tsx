import { VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { useEffect } from "react";
import { NodeUploadStatus, PodLogs } from "../../../src/webview-contract/webviewDefinitions/periscope";
import { NodeActions } from "./NodeActions";
import { NodeLogs } from "./NodeLogs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheckCircle } from "@fortawesome/free-solid-svg-icons";
import styles from "./Periscope.module.css";

export interface SuccessViewProps {
    runId: string;
    clusterName: string;
    uploadStatuses: NodeUploadStatus[];
    onRequestUploadStatusCheck: () => void;
    onNodeClick: (node: string) => void;
    selectedNode: string;
    nodePodLogs: PodLogs[] | null;
    containerUrl: string;
    shareableSas: string;
}

export function SuccessView(props: SuccessViewProps) {
    // Once
    useEffect(() => {
        const interval = setInterval(props.onRequestUploadStatusCheck, 10 * 1000);
        return () => clearInterval(interval);
    }, [props.onRequestUploadStatusCheck]);

    function getNodeRowClassNames(nodeName: string): string {
        return [props.selectedNode === nodeName && styles.selected].filter((s) => s).join(" ");
    }

    function handleRowClick(event: React.MouseEvent, nodeName: string) {
        // If the event came from an anchor element, let it bubble up.
        // The parent iframe needs to handle navigation events.
        if (event.target instanceof HTMLElement && event.target.closest("a,vscode-link")) {
            return;
        }

        props.onNodeClick(nodeName);
    }

    return (
        <>
            <p>
                <FontAwesomeIcon className={styles.successIndicator} icon={faCheckCircle} />
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
                    {props.uploadStatuses.map((status) => (
                        <tr
                            key={status.nodeName}
                            onClick={(e) => handleRowClick(e, status.nodeName)}
                            className={getNodeRowClassNames(status.nodeName)}
                        >
                            <td>
                                {status.isUploaded ? (
                                    <>
                                        <FontAwesomeIcon className={styles.successIndicator} icon={faCheckCircle} />
                                        Uploaded
                                    </>
                                ) : (
                                    <VSCodeProgressRing />
                                )}
                            </td>
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
                    ))}
                </tbody>
            </table>

            <VSCodeDivider />

            {props.selectedNode && props.nodePodLogs && (
                <NodeLogs node={props.selectedNode} podLogs={props.nodePodLogs} />
            )}
        </>
    );
}
