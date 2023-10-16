import { VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/detector";
import { SingleDetector } from './SingleDetector';
import { WebviewStateUpdater, getStateManagement } from "../utilities/state";

type EventDef = {};

type DetectorState = InitialState & {
    portalUrl: string
};

const stateUpdater: WebviewStateUpdater<"detector", EventDef, DetectorState> = {
    createState: initialState => ({
        ...initialState,
        portalUrl: `https://portal.azure.com/#resource${initialState.clusterArmId}aksDiagnostics?referrer_source=vscode&referrer_context=${initialState.portalReferrerContext}`
    }),
    vscodeMessageHandler: {},
    eventHandler: {}
};

export function Detector(initialState: InitialState) {
    const {state} = getStateManagement(stateUpdater, initialState);

    return (
    <>
        <h2>{state.name}</h2>
        {state.description && state.description !== "test" && <p>{state.description}</p>}
        To perform more checks on your cluster, visit <VSCodeLink href={state.portalUrl}>AKS Diagnostics</VSCodeLink>.
        <VSCodeDivider style={{marginTop: "16px"}} />

        {state.detectors.map(detector => (
            <SingleDetector key={detector.name} {...detector}></SingleDetector>
        ))}
    </>
    )
}