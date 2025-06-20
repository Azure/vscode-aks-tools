import { faInfoCircle, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FormEvent, useState } from "react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { useStateManagement } from "../utilities/state";
import { DeleteNodeExplorerDialog } from "./DeleteNodeExplorerDialog";
import styles from "./RetinaCapture.module.css";
import { stateUpdater, vscode } from "./state";
import * as l10n from "@vscode/l10n";
type ChangeEvent = Event | FormEvent<HTMLElement>;

export function RetinaCapture(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode); //eventHandlers
    const [selectedNode, setSelectedNode] = useState<Array<string>>([]);
    const [showDeleteNodeExplorerDialog, setShowDeleteNodeExplorerDialog] = useState(false);

    function handleCaptureFileDownload() {
        const result = selectedNode.join(",");
        vscode.postHandleCaptureFileDownload(result);
    }

    function onSelectNode(e: ChangeEvent, node: string) {
        if ((e.target as HTMLInputElement).checked) {
            setSelectedNode([...selectedNode, node]);
        } else {
            setSelectedNode(selectedNode.filter((n) => n !== node));
        }
    }

    function isNodeSelected(node: string) {
        return selectedNode.includes(node) && state.allNodes.includes(node);
    }

    function handleDeleteExplorerPod() {
        // show delete node explorer dialog
        setShowDeleteNodeExplorerDialog(true);
    }

    return (
        <>
            <header>
                <h2>
                    Retina {l10n.t("Distributed Capture for")} {state.clusterName}
                </h2>
            </header>
            <hr style={{ marginBottom: "1rem" }} />
            <div>
                <FontAwesomeIcon icon={faInfoCircle} />{" "}
                {l10n.t(
                    "Retina capture command allows the user to capture network traffic and metadata for the capture target, and then send the capture file to the location by Output Configuration. More info:",
                )}{" "}
                <a href="https://retina.sh/docs/captures/cli/#output-configurationrequired">
                    Retina {l10n.t("Capture Command")}
                </a>
            </div>
            <hr style={{ marginBottom: "1rem" }} />
            <h3>Retina {l10n.t("Output")}</h3>
            <div>{state.retinaOutput}</div>

            <hr style={{ marginTop: "1rem" }} />
            <h3>Retina {l10n.t("Distributed Capture is Successfully Completed for this Cluster")}</h3>

            <div className={styles.content}>
                {state.isDownloadRetinaCapture && (
                    <div style={{ flexDirection: "row", width: "31.25rem" }}>
                        {state.allNodes.map((node) => (
                            <div key={node}>
                                <input
                                    id={`checkbox-${node}`}
                                    onChange={(e) => onSelectNode(e, node)}
                                    checked={isNodeSelected(node)}
                                    type="checkbox"
                                ></input>
                                <label className={styles.checkboxLabel} htmlFor={`checkbox-${node}`}>
                                    {node}
                                </label>
                            </div>
                        ))}
                        <div className={styles.buttonDiv}>
                            <button
                                type="submit"
                                style={{ marginRight: "0.625rem" }}
                                onClick={() => handleCaptureFileDownload()}
                            >
                                {l10n.t("Download Retina Logs to Host Machine.")}
                            </button>
                            {state.isNodeExplorerPodExists && (
                                <button className="secondary-button" onClick={() => handleDeleteExplorerPod()}>
                                    <span slot="start">
                                        <FontAwesomeIcon icon={faTrash} />
                                    </span>
                                    {l10n.t("Delete Node Explorer Pod")}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showDeleteNodeExplorerDialog && (
                <DeleteNodeExplorerDialog
                    isShown={showDeleteNodeExplorerDialog}
                    nodes={selectedNode}
                    onCancel={() => setShowDeleteNodeExplorerDialog(false)}
                    onAccept={(nodeName) => {
                        console.log(nodeName);
                        vscode.postDeleteRetinaNodeExplorer(nodeName);
                        setShowDeleteNodeExplorerDialog(false);
                    }}
                />
            )}
        </>
    );
}
