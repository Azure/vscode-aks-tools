import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";


export function RetinaCapture(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);


    return (
        <>
            <header>
                <h2>Retina Distributed Capture for {state.clusterName}</h2>
            </header>

            <VSCodeDivider style={{ marginBottom: "1rem" }} />
            <pre>{state.retinaOutput}</pre>
            
            <VSCodeDivider style={{ marginTop: "1rem" }} />
            <h3>Completed Captures</h3>
            

            
        </>
    );
}

