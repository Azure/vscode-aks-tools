import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import styles from "./AzureServiceOperator.module.css";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { useEffect } from "react";
import { InstallStepStatus, stateUpdater, vscode } from "./helpers/state";
import { Progress, StepWithDescription } from "./Progress";
import { getStateManagement } from "../utilities/state";
import { Inputs } from "./Inputs";
import { getRequiredInputs } from "./helpers/inputs";

export function AzureServiceOperator(initialState: InitialState) {
    const {state, eventHandlers, vsCodeMessageHandlers} = getStateManagement(stateUpdater, initialState);

    useEffect(() => {
        vscode.subscribeToMessages(vsCodeMessageHandlers);
    }, []);

    useEffect(() => {
        // The first step is triggered by a button press.
        // The following is for the subsequent steps, which are triggered by state changes.
        if (state.installCertManagerStep.status === InstallStepStatus.Succeeded && state.waitForCertManagerStep.status === InstallStepStatus.NotStarted) {
            vscode.postWaitForCertManagerRequest();
            eventHandlers.onSetWaitForCertManagerStarted();
        }

        if (state.waitForCertManagerStep.status === InstallStepStatus.Succeeded && state.installOperatorStep.status === InstallStepStatus.NotStarted) {
            vscode.postInstallOperatorRequest();
            eventHandlers.onSetInstallOperatorStarted();
        }

        if (state.installOperatorStep.status === InstallStepStatus.Succeeded && state.installOperatorSettingsStep.status === InstallStepStatus.NotStarted) {
            const parameters = getRequiredInputs(state);
            if (!parameters) throw new Error(`Missing setting in state: ${JSON.stringify(state)}`);
            vscode.postInstallOperatorSettingsRequest(parameters);
            eventHandlers.onSetInstallOperatorSettingsStarted();
        }

        if (state.installOperatorSettingsStep.status === InstallStepStatus.Succeeded && state.waitForControllerManagerStep.status === InstallStepStatus.NotStarted) {
            vscode.postWaitForControllerManagerRequest();
            eventHandlers.onSetWaitForControllerManagerStarted();
        }
    });

    const steps: StepWithDescription[] = [
        {step: state.checkSPStep, description: "Check the Service Principal"},
        {step: state.installCertManagerStep, description: "Install Cert Manager"},
        {step: state.waitForCertManagerStep, description: "Wait for Cert Manager"},
        {step: state.installOperatorStep, description: "Install the ASO Operator"},
        {step: state.installOperatorSettingsStep, description: "Install the Operator Settings"},
        {step: state.waitForControllerManagerStep, description: "Wait for the Controller Manager to become ready"}
    ];

    return (
    <>
        <h2>Azure Service Operator on {state.clusterName}</h2>
        <p>
            The Azure Service Operator helps you provision Azure resources and connect your applications to them from within Kubernetes.
            <VSCodeLink href="https://aka.ms/aks/aso">&nbsp;Learn more</VSCodeLink>
        </p>
        <div className={styles.content}>
            <div className={styles.inputPane}>
                <Inputs state={state} handlers={eventHandlers} vscode={vscode} />
            </div>
            <div className={styles.progressPane}>
                <Progress steps={steps} />
            </div>
        </div>
    </>
    );
}