import { CaptureName, InitialState } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import { useEffect } from "react";
import { VSCodeButton, VSCodeDivider, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { getStateManagement } from "../utilities/state";
import { CaptureStatus, NodeStatus, stateUpdater, vscode } from "./state";
import { NodeSelector } from "../components/NodeSelector";

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
        const captureName = new Date().toISOString().replaceAll(":", "-").replace("T", "_");
        vscode.postStartCapture({node: state.selectedNode, capture: captureName});
        eventHandlers.onStartingNodeCapture({node: state.selectedNode, capture: captureName});
    }

    function handleStopCapture() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.CaptureRunning) return;
        vscode.postStopCapture({node: state.selectedNode});
        eventHandlers.onStoppingNodeCapture({node: state.selectedNode});
    }

    function handleStartDownload(captureName: CaptureName) {
        if (!state.selectedNode) return;
        vscode.postDownloadCaptureFile({node: state.selectedNode, capture: captureName});
        eventHandlers.onDownloadingNodeCapture({node: state.selectedNode, capture: captureName});
    }

    function handleOpenFile(filePath: string) {
        console.log(`Opening file ${filePath}`);
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
                <NodeSelector nodes={state.allNodes} onNodeChanged={eventHandlers.onSetSelectedNode} id="node-dropdown" className={styles.control} />
            </div>
            <div className={styles.buttons}>
                {hasStatus(NodeStatus.Checking) && <><VSCodeProgressRing />Checking Node</>}
                {hasStatus(NodeStatus.Clean, NodeStatus.CreatingDebugPod) &&
                    <VSCodeButton onClick={handleCreateDebugPod} disabled={hasStatus(NodeStatus.CreatingDebugPod)}>
                        {hasStatus(NodeStatus.CreatingDebugPod) && <VSCodeProgressRing />}
                        Create Debug Pod
                    </VSCodeButton>
                }

                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.DeletingDebugPod) &&
                    <VSCodeButton onClick={handleRemoveDebugPod} disabled={hasStatus(NodeStatus.DeletingDebugPod)}>
                        {hasStatus(NodeStatus.DeletingDebugPod) && <VSCodeProgressRing />}
                        Remove Debug Pod
                    </VSCodeButton>
                }

                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.CaptureStarting) &&
                    <VSCodeButton onClick={handleStartCapture} disabled={hasStatus(NodeStatus.CaptureStarting)}>
                        {hasStatus(NodeStatus.CaptureStarting) && <VSCodeProgressRing />}
                        Start Capture
                    </VSCodeButton>
                }

                {hasStatus(NodeStatus.CaptureRunning, NodeStatus.CaptureStopping) &&
                    <VSCodeButton onClick={handleStopCapture} disabled={hasStatus(NodeStatus.CaptureStopping)}>
                        {hasStatus(NodeStatus.CaptureStopping) && <VSCodeProgressRing />}
                        Stop Capture
                    </VSCodeButton>
                }

                {hasStatus(NodeStatus.DebugPodRunning) && nodeState && nodeState.completedCaptures.length > 0 && (
                    <table>
                        <thead>
                            <tr>
                                <th>Capture</th>
                                <th>Operation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {nodeState.completedCaptures.map(c => (
                                <tr>
                                    <td>{c.name}</td>
                                    <td>
                                        {!c.downloadedFilePath &&
                                            <VSCodeButton onClick={() => handleStartDownload(c.name)} disabled={c.status === CaptureStatus.Downloaded}>
                                                {c.status === CaptureStatus.Downloading && <VSCodeProgressRing />}
                                                Download
                                            </VSCodeButton>
                                        }

                                        {c.downloadedFilePath &&
                                            <VSCodeButton onClick={() => handleOpenFile(c.downloadedFilePath!)}>
                                                Open
                                            </VSCodeButton>
                                        }
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </>
    );;
}