import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";


export function RetinaCapture(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

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
                Retina capture command allows the user to capture network traffic and metadata for the capture target, and then send the capture file to the location by Output Configuration.
                More info: <a href="https://retina.sh/docs/captures/cli/#output-configurationrequired">Retina Capture Command</a>
            </div>
            <VSCodeDivider style={{ marginBottom: "1rem" }} />
            <pre>{state.retinaOutput}</pre>

            <VSCodeDivider style={{ marginTop: "1rem" }} />
            <h3>Retina Disctributed Capture is Successfully Completed for following Nodes in this Cluster</h3>

            <pre>{state.allNodes}</pre>

            <VSCodeDivider style={{ marginBottom: "1rem" }} />

            <VSCodeButton onClick={() => ({})} appearance="secondary">
                Run Node-Explorer Pod to Move Captured logs to host machine.
            </VSCodeButton>

            <VSCodeButton appearance="icon" title="Open Folder">
                <FontAwesomeIcon
                    icon={faFolderOpen}
                    onClick={() => handleOpenFolderClick(`/tmp/capture`)}
                />
            </VSCodeButton>
        </>
    );
}

