import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { faFolderOpen, faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { NodeSelector } from "../components/NodeSelector";
import styles from "./RetinaCapture.module.css";

export function RetinaCapture(initialState: InitialState) {
    const { state, eventHandlers } = useStateManagement(stateUpdater, initialState, vscode); //eventHandlers

    function handleNodeExplorerPod() {
        const nodeName = (document.getElementById('node-dropdown') as HTMLSelectElement).value;
        vscode.postRunRetinaCapture(nodeName);
        (document.getElementsByClassName('downloadednodes') as HTMLSelectElement).innerText = `Node ${nodeName} is capture here: ${state.captureFolderName}`;
    }

    function handleOpenFolderClick(path: string) {
        vscode.postOpenFolder(path);
    }

    return (
        <>
            <header>
                <h2>Retina Distributed Capture for {state.clusterName}</h2>
            </header>

            <VSCodeDivider style={{ marginBottom: "1rem" }} />
            <div>
                <FontAwesomeIcon icon={faInfoCircle} /> Retina capture command allows the user to capture network traffic and metadata for the capture target, and then send the capture file to the location by Output Configuration. More info: <a href="https://retina.sh/docs/captures/cli/#output-configurationrequired">Retina Capture Command</a>
            </div>
            <VSCodeDivider style={{ marginBottom: "1rem" }} />
            <pre>{state.retinaOutput}</pre>

            <VSCodeDivider style={{ marginTop: "1rem" }} />
            <h3>Retina Disctributed Capture is Successfully Completed for this Cluster</h3>

            <div className={styles.content}>
                <label htmlFor="node-dropdown" className={styles.label}>
                    Select Node to Capture Traffic:
                </label>
                <NodeSelector
                    nodes={state.allNodes}
                    onNodeChanged={() => eventHandlers.onSetSelectedNode}
                    id="node-dropdown"
                    className={styles.controlDropdown}
                />
            </div>
            <div className={styles.buttonContainer} style={{ justifyContent: "flex-end" }}>
                <VSCodeButton type="submit" onClick={handleNodeExplorerPod} appearance="secondary">
                    Capture Retina logs to Host Machine.
                </VSCodeButton>

                <span className="downloadednodes"></span> : <VSCodeButton appearance="icon" title="Open Folder">
                    <FontAwesomeIcon
                        icon={faFolderOpen}
                        onClick={() => handleOpenFolderClick(`${state.captureFolderName}`)}
                    />
                </VSCodeButton>
            </div>
            <VSCodeDivider style={{ marginBottom: "1rem" }} />

        </>
    );
}
