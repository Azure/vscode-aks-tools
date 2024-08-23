import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { InitialState, ProgressEventType } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { useStateManagement } from "../utilities/state";
import { stateUpdater, vscode } from "./state";

export function Kaito(initialState: InitialState) {
    const { state } = useStateManagement(stateUpdater, initialState, vscode);

    function onClickKaitoInstall() {
        vscode.postInstallKaitoRequest();
    }

    return (
        <>
            <h1>Kubernetes AI Toolchain Operator (KAITO) </h1>
            <label>
                Using KAITO, the workflow of onboarding and deploying large AI inference models on your AKS cluster is
                largely simplified.
            </label>
            <label>Version: v1.0</label>
            <label>Architecture</label>
            <label>Cluster Name: {initialState.clusterName}</label>
            <label>KAITO follows classic Kubernetes Custom Resource Definition(CRD)/controller pattern</label>
            {state.kaitoInstallStatus === ProgressEventType.NotStarted && (
                <VSCodeButton onClick={onClickKaitoInstall}>Install KAITO</VSCodeButton>
            )}
            {state.kaitoInstallStatus === ProgressEventType.InProgress && (
                <p>Installing KAITO, this may take a few minutes...</p>
            )}
            {state.kaitoInstallStatus === ProgressEventType.Success && state.models.length > 0 && (
                // <KaitoFamilyModelInput modelDetails={state.models} />
                <p>Kaito is installed, tada..</p>
            )}
        </>
    );
}
