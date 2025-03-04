import { InitialState } from "../../../src/webview-contract/webviewDefinitions/detector";
import { SingleDetector } from "./SingleDetector";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function Detector(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

    return (
        <>
            <h2>{state.name}</h2>
            {state.description && state.description !== "test" && <p>{state.description}</p>}
            To perform more checks on your cluster, visit <a href={state.portalDetectorUrl}>AKS Diagnostics</a>.
            <hr style={{ marginTop: "16px" }} />
            {state.detectors.map((detector) => (
                <SingleDetector key={detector.name} {...detector}></SingleDetector>
            ))}
        </>
    );
}
