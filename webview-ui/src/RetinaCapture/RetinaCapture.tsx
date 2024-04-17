import { faInfoCircle, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VSCodeButton, VSCodeCheckbox, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { FormEvent, useState } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { useStateManagement } from "../utilities/state";
import styles from "./RetinaCapture.module.css";
import { stateUpdater, vscode } from "./state";


type ChangeEvent = Event | FormEvent<HTMLElement>;

export function RetinaCapture(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode); //eventHandlers
    const [selectedNode, setSelectedNode] = useState<Array<string>>([]);

    function handleCaptureFileDownload() {
        const result = selectedNode.join(',');
        vscode.postHandleCaptureFileDownload(result);
    }

    function onSelectNode(e: ChangeEvent, node: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedNode([...selectedNode, node]);
        } else {
            setSelectedNode(selectedNode.filter(n => n !== node));
        }
    }

    function isNodeSelected(node: string) {
        return selectedNode.includes(node) && state.allNodes.includes(node);
    }

    function handleDeleteExplorerPod(node: string) {
        vscode.postDeleteRetinaNodeExplorer(node);
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
            <h3>Retina Output</h3>
            <div>
                {state.retinaOutput}
            </div>

            <VSCodeDivider style={{ marginTop: "1rem" }} />
            <h3>Retina Distributed Capture is Successfully Completed for this Cluster</h3>


            <div className={styles.content}>
                <div style={{ flexDirection: 'row', width: '500px' }}>
                    {state.allNodes.map((node) => (
                        <div key={node}>
                            <VSCodeCheckbox
                                onChange={(e) => onSelectNode(e, node)}
                                checked={isNodeSelected(node)}>
                                {node}
                            </VSCodeCheckbox>
                            <VSCodeButton appearance="secondary" onClick={() => handleDeleteExplorerPod(node)}>
                                <span slot="start">
                                    <FontAwesomeIcon icon={faTrash} />
                                </span>
                                Delete Node Explorer Pod
                            </VSCodeButton>
                        </div>
                    ))}
                    <VSCodeButton type="submit" onClick={() => handleCaptureFileDownload()}>
                        Download Retina Logs to Host Machine.
                    </VSCodeButton>
                </div>
            </div>
        </>
    );
}
