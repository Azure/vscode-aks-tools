import { CaptureName, InitialState } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import { useEffect } from "react";
import { VSCodeButton, VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { getStateManagement } from "../utilities/state";
import { CaptureStatus, NodeStatus, stateUpdater, vscode } from "./state";
import { NodeSelector } from "../components/NodeSelector";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faDownload, faPlay, faPlus, faSpinner, faStop, faTrash } from "@fortawesome/free-solid-svg-icons";

export function TcpDump(initialState: InitialState) {
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    useEffect(() => {
        vscode.subscribeToMessages(vsCodeMessageHandlers);

        if (state.selectedNode && state.nodeStates[state.selectedNode].status === NodeStatus.Unknown) {
            vscode.postCheckNodeState({node: state.selectedNode});
            eventHandlers.onSetCheckingNodeState({node: state.selectedNode});
        }
    });

    function handleCreateDebugPod() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.Clean) return;
        vscode.postStartDebugPod({node: state.selectedNode});
        eventHandlers.onCreatingNodeDebugPod({node: state.selectedNode});
    }

    function handleRemoveDebugPod() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.DebugPodRunning) return;
        vscode.postDeleteDebugPod({node: state.selectedNode});
        eventHandlers.onDeletingNodeDebugPod({node: state.selectedNode});
    }

    function handleStartCapture() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.DebugPodRunning) return;
        const captureName = new Date().toISOString().slice(0,-5).replaceAll(":", "-").replace("T", "_");
        vscode.postStartCapture({node: state.selectedNode, capture: captureName});
        eventHandlers.onStartingNodeCapture({node: state.selectedNode, capture: captureName});
    }

    function handleStopCapture() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.CaptureRunning) return;
        if (!nodeState.currentCaptureName) return;
        vscode.postStopCapture({node: state.selectedNode, capture: nodeState.currentCaptureName});
        eventHandlers.onStoppingNodeCapture({node: state.selectedNode});
    }

    function handleStartDownload(captureName: CaptureName) {
        if (!state.selectedNode) return;
        vscode.postDownloadCaptureFile({node: state.selectedNode, capture: captureName});
        eventHandlers.onDownloadingNodeCapture({node: state.selectedNode, capture: captureName});
    }

    function handleCopyDownloadPathClick(path: string) {
        navigator.clipboard.writeText(path);
    }

    const nodeState = state.selectedNode ? state.nodeStates[state.selectedNode] : null;
    function hasStatus(...statuses: NodeStatus[]): boolean {
        return nodeState !== null && statuses.includes(nodeState.status);
    }

    return (
        <>
            <header>
                <h2>TCP Dump from Linux Node {state.clusterName}</h2>
                <VSCodeDivider />
            </header>
            <div className={styles.content}>
                <label htmlFor="node-dropdown" className={styles.label}>Node:</label>
                <NodeSelector nodes={state.allNodes} onNodeChanged={eventHandlers.onSetSelectedNode} id="node-dropdown" className={styles.controlDropdown} />

                {hasStatus(NodeStatus.Checking) &&
                <div className={styles.control} style={{display: "flex"}}>
                    <VSCodeProgressRing style={{height: "1rem"}} />
                    Checking Node
                </div>
                }

                <label className={styles.label}>Debug Pod</label>
                {hasStatus(NodeStatus.Clean, NodeStatus.CreatingDebugPod) &&
                    <VSCodeButton onClick={handleCreateDebugPod} disabled={!hasStatus(NodeStatus.Clean)} className={styles.controlButton} >
                        {hasStatus(NodeStatus.CreatingDebugPod) && <span slot="start"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></span>}
                        {!hasStatus(NodeStatus.CreatingDebugPod) && <span slot="start"><FontAwesomeIcon icon={faPlus} /></span>}
                        Create
                    </VSCodeButton>
                }
                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.DeletingDebugPod, NodeStatus.CaptureStarting, NodeStatus.CaptureRunning, NodeStatus.CaptureStopping) &&
                    <VSCodeButton onClick={handleRemoveDebugPod} disabled={!hasStatus(NodeStatus.DebugPodRunning)} className={styles.controlButton} appearance="secondary" >
                        {hasStatus(NodeStatus.DeletingDebugPod) && <span slot="start"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></span>}
                        {!hasStatus(NodeStatus.DeletingDebugPod) && <span slot="start"><FontAwesomeIcon icon={faTrash} /></span>}
                        Delete
                    </VSCodeButton>
                }

                <label className={styles.label}>Capture</label>
                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.CaptureStarting) &&
                    <VSCodeButton onClick={handleStartCapture} disabled={!hasStatus(NodeStatus.DebugPodRunning)} className={styles.controlButton} >
                        {hasStatus(NodeStatus.CaptureStarting) && <span slot="start"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></span>}
                        {!hasStatus(NodeStatus.CaptureStarting) && <span slot="start"><FontAwesomeIcon icon={faPlay} /></span>}
                        Start
                    </VSCodeButton>
                }
                {hasStatus(NodeStatus.CaptureRunning, NodeStatus.CaptureStopping) &&
                    <VSCodeButton onClick={handleStopCapture} disabled={!hasStatus(NodeStatus.CaptureRunning)} className={styles.controlButton} >
                        {hasStatus(NodeStatus.CaptureStopping) && <span slot="start"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></span>}
                        {!hasStatus(NodeStatus.CaptureStopping) && <span slot="start"><FontAwesomeIcon icon={faStop} /></span>}
                        Stop
                    </VSCodeButton>
                }

                <label className={styles.label}>Saved Captures</label>
                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.CaptureStarting, NodeStatus.CaptureRunning, NodeStatus.CaptureStopping) && nodeState && nodeState.completedCaptures.length > 0 && (
                    <table className={[styles.control, styles.capturelist].join(' ')} >
                        <thead>
                            <tr>
                                <th>Capture</th>
                                <th>Local Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {nodeState.completedCaptures.map(c => (
                                <tr key={c.name}>
                                    <td>{c.name}</td>
                                    <td>
                                        {!c.downloadedFilePath &&
                                            <VSCodeButton onClick={() => handleStartDownload(c.name)} disabled={c.status !== CaptureStatus.Completed} appearance="secondary">
                                                {c.status === CaptureStatus.Downloading && <span slot="start"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></span>}
                                                {c.status === CaptureStatus.Completed && <span slot="start"><FontAwesomeIcon icon={faDownload} /></span>}
                                                Download
                                            </VSCodeButton>
                                        }

                                        {c.downloadedFilePath &&
                                            <div style={{display: "flex"}}>
                                                <span>{c.downloadedFilePath}</span>
                                                &nbsp;
                                                <VSCodeButton appearance="icon" title="Copy Path"><FontAwesomeIcon icon={faCopy} onClick={() => handleCopyDownloadPathClick(c.downloadedFilePath!)} /></VSCodeButton>
                                            </div>
                                        }
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {nodeState?.errorMessage &&
                <>
                    <label className={styles.label}>Error:</label>
                    <pre className={styles.control}>{nodeState?.errorMessage}</pre>
                </>
                }
            </div>
        </>
    );;
}