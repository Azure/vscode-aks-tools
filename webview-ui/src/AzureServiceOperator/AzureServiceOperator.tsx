import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import styles from "./AzureServiceOperator.module.css";
import { InitialState, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { getWebviewMessageContext } from "../utilities/vscode";
import { useEffect, useReducer } from "react";
import { InstallStepStatus, createState, updateState, userMessageHandler, vscodeMessageHandler } from "./helpers/state";
import { Progress, StepWithDescription } from "./Progress";
import { getEventHandlers, getMessageHandler } from "../utilities/state";
import { UserMsgDef } from "./helpers/userCommands";
import { Inputs } from "./Inputs";
import { getRequiredInputs } from "./helpers/inputs";

export function AzureServiceOperator(props: InitialState) {
    const vscode = getWebviewMessageContext<"aso">();

    const [state, dispatch] = useReducer(updateState, createState());

    const userMessageEventHandlers = getEventHandlers<UserMsgDef>(dispatch, userMessageHandler);

    useEffect(() => {
        const msgHandler = getMessageHandler<ToWebViewMsgDef>(dispatch, vscodeMessageHandler);
        vscode.subscribeToMessages(msgHandler);
    }, []);

    useEffect(() => {
        // The first step is triggered by a button press.
        // The following is for the subsequent steps, which are triggered by state changes.
        if (state.installCertManagerStep.status === InstallStepStatus.Succeeded && state.waitForCertManagerStep.status === InstallStepStatus.NotStarted) {
            vscode.postMessage({ command: "waitForCertManagerRequest", parameters: undefined });
            userMessageEventHandlers.onSetWaitForCertManagerStarted();
        }

        if (state.waitForCertManagerStep.status === InstallStepStatus.Succeeded && state.installOperatorStep.status === InstallStepStatus.NotStarted) {
            vscode.postMessage({ command: "installOperatorRequest", parameters: undefined });
            userMessageEventHandlers.onSetInstallOperatorStarted();
        }

        if (state.installOperatorStep.status === InstallStepStatus.Succeeded && state.installOperatorSettingsStep.status === InstallStepStatus.NotStarted) {
            const parameters = getRequiredInputs(state);
            if (!parameters) throw new Error(`Missing setting in state: ${JSON.stringify(state)}`);
            vscode.postMessage({ command: "installOperatorSettingsRequest", parameters });
            userMessageEventHandlers.onSetInstallOperatorSettingsStarted();
        }

        if (state.installOperatorSettingsStep.status === InstallStepStatus.Succeeded && state.waitForControllerManagerStep.status === InstallStepStatus.NotStarted) {
            vscode.postMessage({ command: "waitForControllerManagerRequest", parameters: undefined });
            userMessageEventHandlers.onSetWaitForControllerManagerStarted();
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
        <h2>Azure Service Operator on {props.clusterName}</h2>
        <p>
            The Azure Service Operator helps you provision Azure resources and connect your applications to them from within Kubernetes.
            <VSCodeLink href="https://aka.ms/aks/aso">&nbsp;Learn more</VSCodeLink>
        </p>
        <div className={styles.content}>
            <div className={styles.inputPane}>
                <Inputs state={state} handlers={userMessageEventHandlers} vscode={vscode} />
            </div>
            <div className={styles.progressPane}>
                <Progress steps={steps} />
            </div>
        </div>
    </>
    );
}