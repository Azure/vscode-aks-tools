import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
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
            To perform more checks on your cluster, visit{" "}
            <VSCodeLink href={state.portalUrl}>AKS Diagnostics</VSCodeLink>.
            <VSCodeDivider style={{ marginTop: "16px" }} />
            {state.detectors.map((detector) => (
                <SingleDetector key={detector.name} {...detector}></SingleDetector>
            ))}
        </>
    );
}
