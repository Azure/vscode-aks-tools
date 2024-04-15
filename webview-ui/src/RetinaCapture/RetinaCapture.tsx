import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styles from "./RetinaCapture.module.css";

export function RetinaCapture(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode); //eventHandlers

    function handleNodeExplorerPod(nodeName: string) {
        vscode.postRunRetinaCapture(nodeName);
        document.getElementById(nodeName)?.showPopover();
    }

    // function handleOpenFolderClick(path: string) {
    //     vscode.postOpenFolder(path);
    // }

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
                </label>
                <table>
                    <tbody>
                        {state.allNodes.toString().split(",").map((node, index) => (
                            <tr key={index}>
                                <td>
                                    {node} -
                                    <VSCodeButton type="submit" onClick={() => handleNodeExplorerPod(node)} appearance="secondary">
                                        Capture logs to Host Machine.
                                    </VSCodeButton>
                                    {/* <VSCodeButton appearance="icon" title="Open Folder" id={node} >
                                        <FontAwesomeIcon
                                            icon={faFolderOpen}
                                            display={"block"}
                                            onClick={() => handleOpenFolderClick(`${state.captureFolderName}`)}
                                        />
                                    </VSCodeButton> */}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <VSCodeDivider style={{ marginBottom: "1rem" }} />

            </div>
        </>
    );
}
