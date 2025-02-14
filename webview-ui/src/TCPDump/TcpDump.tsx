import { CaptureName, InitialState } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import styles from "./TcpDump.module.css";
import { useEffect } from "react";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";
import { CaptureStatus, NodeState, NodeStatus, TcpDumpState, stateUpdater, vscode } from "./state";
import { NodeSelector } from "../components/NodeSelector";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCopy,
    faDownload,
    faFolderOpen,
    faPlay,
    faPlus,
    faSpinner,
    faStop,
    faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { CaptureFilters } from "./CaptureFilters";
import { EventHandlerFunc } from "./state/dataLoading";

export function TcpDump(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode);

    const updates: EventHandlerFunc[] = [];
    const { nodeState } = prepareData(state, updates);
    useEffect(() => {
        updates.map((fn) => fn(eventHandlers));
    });

    function handleCreateDebugPod() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.Clean) return;
        vscode.postStartDebugPod({ node: state.selectedNode });
        eventHandlers.onCreatingNodeDebugPod({ node: state.selectedNode });
    }

    function handleRemoveDebugPod() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.DebugPodRunning) return;
        vscode.postDeleteDebugPod({ node: state.selectedNode });
        eventHandlers.onDeletingNodeDebugPod({ node: state.selectedNode });
    }

    function handleStartCapture() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.DebugPodRunning) return;
        const captureName = new Date().toISOString().slice(0, -5).replaceAll(":", "-").replace("T", "_");
        vscode.postStartCapture({
            node: state.selectedNode,
            capture: captureName,
            filters: {
                interface: nodeState.currentCaptureFilters.interface,
                pcapFilterString: nodeState.currentCaptureFilters.pcapFilterString,
            },
        });
        eventHandlers.onStartingNodeCapture({ node: state.selectedNode, capture: captureName });
    }

    function handleStopCapture() {
        if (!state.selectedNode) return;
        const nodeState = state.nodeStates[state.selectedNode];
        if (nodeState.status !== NodeStatus.CaptureRunning) return;
        if (!nodeState.currentCaptureName) return;
        vscode.postStopCapture({ node: state.selectedNode, capture: nodeState.currentCaptureName });
        eventHandlers.onStoppingNodeCapture({ node: state.selectedNode });
    }

    function handleStartDownload(captureName: CaptureName) {
        if (!state.selectedNode) return;
        vscode.postDownloadCaptureFile({ node: state.selectedNode, capture: captureName });
        eventHandlers.onDownloadingNodeCapture({ node: state.selectedNode, capture: captureName });
    }

    function handleCopyDownloadPathClick(path: string) {
        navigator.clipboard.writeText(path);
    }

    function handleOpenFolderClick(path: string) {
        vscode.postOpenFolder(path);
    }

    function hasStatus(...statuses: NodeStatus[]): boolean {
        return nodeState !== null && statuses.includes(nodeState.status);
    }

    return (
        <>
            <header>
                <h2>TCP Capture on {state.clusterName}</h2>
            </header>

            <hr style={{ marginBottom: "1rem" }} />

            <div className={styles.content}>
                <label htmlFor="node-dropdown" className={styles.label}>
                    Node:
                </label>
                <NodeSelector
                    nodes={state.allNodes}
                    onNodeChanged={eventHandlers.onSetSelectedNode}
                    id="node-dropdown"
                    className={styles.controlDropdown}
                />

                {hasStatus(NodeStatus.Checking) && (
                    <div className={styles.control} style={{ display: "flex" }}>
                        <VSCodeProgressRing style={{ height: "1rem" }} />
                        Checking Node
                    </div>
                )}

                <label className={styles.label}>Debug Pod</label>
                {hasStatus(NodeStatus.Clean, NodeStatus.CreatingDebugPod) && (
                    <button
                        onClick={handleCreateDebugPod}
                        disabled={!hasStatus(NodeStatus.Clean)}
                        className={styles.controlButton}
                    >
                        {hasStatus(NodeStatus.CreatingDebugPod) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
                            </span>
                        )}
                        {!hasStatus(NodeStatus.CreatingDebugPod) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faPlus} />
                            </span>
                        )}
                        Create
                    </button>
                )}
                {hasStatus(
                    NodeStatus.DebugPodRunning,
                    NodeStatus.DeletingDebugPod,
                    NodeStatus.CaptureStarting,
                    NodeStatus.CaptureRunning,
                    NodeStatus.CaptureStopping,
                ) && (
                    <button
                        onClick={handleRemoveDebugPod}
                        disabled={!hasStatus(NodeStatus.DebugPodRunning)}
                        className={`${styles.controlButton} secondary-button`}
                    >
                        {hasStatus(NodeStatus.DeletingDebugPod) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
                            </span>
                        )}
                        {!hasStatus(NodeStatus.DeletingDebugPod) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faTrash} />
                            </span>
                        )}
                        Delete
                    </button>
                )}

                {state.selectedNode &&
                    nodeState &&
                    hasStatus(NodeStatus.DebugPodRunning, NodeStatus.CaptureStarting) && (
                        <details className={styles.fullWidth}>
                            <summary>Filters</summary>
                            <CaptureFilters
                                captureNode={state.selectedNode}
                                nodeState={nodeState}
                                referenceData={state.referenceData}
                                eventHandlers={eventHandlers}
                            />
                        </details>
                    )}

                <label className={styles.label}>Capture</label>
                {hasStatus(NodeStatus.DebugPodRunning, NodeStatus.CaptureStarting) && (
                    <button
                        onClick={handleStartCapture}
                        disabled={!hasStatus(NodeStatus.DebugPodRunning)}
                        className={styles.controlButton}
                    >
                        {hasStatus(NodeStatus.CaptureStarting) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
                            </span>
                        )}
                        {!hasStatus(NodeStatus.CaptureStarting) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faPlay} />
                            </span>
                        )}
                        Start
                    </button>
                )}
                {hasStatus(NodeStatus.CaptureRunning, NodeStatus.CaptureStopping) && (
                    <button
                        onClick={handleStopCapture}
                        disabled={!hasStatus(NodeStatus.CaptureRunning)}
                        className={styles.controlButton}
                    >
                        {hasStatus(NodeStatus.CaptureStopping) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
                            </span>
                        )}
                        {!hasStatus(NodeStatus.CaptureStopping) && (
                            <span slot="start">
                                <FontAwesomeIcon icon={faStop} />
                            </span>
                        )}
                        Stop
                    </button>
                )}
            </div>
            <hr style={{ marginTop: "1rem" }} />
            <h3>Completed Captures</h3>
            {hasStatus(
                NodeStatus.DebugPodRunning,
                NodeStatus.CaptureStarting,
                NodeStatus.CaptureRunning,
                NodeStatus.CaptureStopping,
            ) &&
                nodeState &&
                nodeState.completedCaptures.length > 0 && (
                    <table className={styles.capturelist}>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Size (kB)</th>
                                <th>Local Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {nodeState.completedCaptures.map((c) => (
                                <tr key={c.name}>
                                    <td>{c.name}</td>
                                    <td>{c.sizeInKB}</td>
                                    <td>
                                        {!c.downloadedFilePath && (
                                            <button
                                                onClick={() => handleStartDownload(c.name)}
                                                disabled={c.status !== CaptureStatus.Completed}
                                                className="secondary-button"
                                            >
                                                {c.status === CaptureStatus.Downloading && (
                                                    <span slot="start">
                                                        <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
                                                    </span>
                                                )}
                                                {c.status === CaptureStatus.Completed && (
                                                    <span slot="start">
                                                        <FontAwesomeIcon icon={faDownload} />
                                                    </span>
                                                )}
                                                Download
                                            </button>
                                        )}

                                        {c.downloadedFilePath && (
                                            <div style={{ display: "flex" }}>
                                                <span>{c.downloadedFilePath}</span>
                                                &nbsp;
                                                <button className="icon-button" title="Copy Path">
                                                    <FontAwesomeIcon
                                                        icon={faCopy}
                                                        onClick={() =>
                                                            handleCopyDownloadPathClick(c.downloadedFilePath!)
                                                        }
                                                    />
                                                </button>
                                                <button className="icon-button" title="Open Folder">
                                                    <FontAwesomeIcon
                                                        icon={faFolderOpen}
                                                        onClick={() => handleOpenFolderClick(c.downloadedFilePath!)}
                                                    />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

            {nodeState?.errorMessage && (
                <>
                    <label className={styles.label}>Error:</label>
                    <pre className={styles.control}>{nodeState?.errorMessage}</pre>
                </>
            )}
        </>
    );
}

type LocalData = {
    nodeState: NodeState | null;
};

function prepareData(state: TcpDumpState, updates: EventHandlerFunc[]): LocalData {
    const captureNode = state.selectedNode;
    if (!captureNode) {
        return { nodeState: null };
    }

    const nodeState = state.nodeStates[captureNode];
    if (nodeState.status === NodeStatus.Unknown) {
        vscode.postCheckNodeState({ node: captureNode });
        updates.push((e) => e.onSetCheckingNodeState({ node: captureNode }));
    }

    return { nodeState };
}
