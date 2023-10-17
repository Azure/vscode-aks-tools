import { AzureCloudName, InitialState, InstallStepResult, Subscription } from "../../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { WebviewStateUpdater } from "../../utilities/state";
import { getWebviewMessageContext } from "../../utilities/vscode";

export enum InstallStepStatus {
    NotStarted,
    InProgress,
    Succeeded,
    Failed
}

export interface InstallStep {
    status: InstallStepStatus
    result: InstallStepResult | null
}

export type ASOState = InitialState & {
    appId: string | null
    appSecret: string | null
    cloudName: AzureCloudName | null
    tenantId: string | null
    subscriptions: Subscription[]
    selectedSubscription: Subscription | null
    checkSPStep: InstallStep
    installCertManagerStep: InstallStep
    waitForCertManagerStep: InstallStep
    installOperatorStep: InstallStep
    installOperatorSettingsStep: InstallStep
    waitForControllerManagerStep: InstallStep
}

function newStep(): InstallStep {
    return {status: InstallStepStatus.NotStarted, result: null};
}

function inProgressStep(): InstallStep {
    return {status: InstallStepStatus.InProgress, result: null};
}

function completedStep(succeeded: boolean, result: InstallStepResult | null): InstallStep {
    return {status: succeeded ? InstallStepStatus.Succeeded : InstallStepStatus.Failed, result};
}

export type EventDef = {
    setAppId: string | null
    setAppSecret: string | null
    setCheckingSP: void
    setSelectedSubscriptionId: string | null
    setInstallCertManagerStarted: void
    setWaitForCertManagerStarted: void
    setInstallOperatorStarted: void
    setInstallOperatorSettingsStarted: void
    setWaitForControllerManagerStarted: void
};

export const stateUpdater: WebviewStateUpdater<"aso", EventDef, ASOState> = {
    createState: initialState => ({
        ...initialState,
        appId: null,
        appSecret: null,
        cloudName: null,
        tenantId: null,
        subscriptions: [],
        selectedSubscription: null,
        checkSPStep: newStep(),
        installCertManagerStep: newStep(),
        waitForCertManagerStep: newStep(),
        installOperatorStep: newStep(),
        installOperatorSettingsStep: newStep(),
        waitForControllerManagerStep: newStep()
    }),
    vscodeMessageHandler: {
        checkSPResponse: (state, args) => ({
            ...state,
            checkSPStep: completedStep(args.succeeded, args),
            cloudName: args.cloudName,
            tenantId: args.tenantId,
            subscriptions: args.subscriptions,
            selectedSubscription: args.subscriptions.length === 1 ? args.subscriptions[0] : null
        }),
        installCertManagerResponse: (state, args) => ({ ...state, installCertManagerStep: completedStep(args.succeeded, args) }),
        waitForCertManagerResponse: (state, args) => ({ ...state, waitForCertManagerStep: completedStep(args.succeeded, args) }),
        installOperatorResponse: (state, args) => ({ ...state, installOperatorStep: completedStep(args.succeeded, args) }),
        installOperatorSettingsResponse: (state, args) => ({ ...state, installOperatorSettingsStep: completedStep(args.succeeded, args) }),
        waitForControllerManagerResponse: (state, args) => ({ ...state, waitForControllerManagerStep: completedStep(args.succeeded, args) })
    },
    eventHandler: {
        setAppId: (state, appId) => ({ ...state, appId: appId || null }),
        setAppSecret: (state, appSecret) => ({ ...state, appSecret: appSecret || null }),
        setCheckingSP: (state, _args) => ({ ...state, checkSPStep: inProgressStep() }),
        setSelectedSubscriptionId: (state, subId) => ({ ...state, selectedSubscription: state.subscriptions.find(s => s.id === subId) || null }),
        setInstallCertManagerStarted: (state, _args) => ({ ...state, installCertManagerStep: inProgressStep() }),
        setWaitForCertManagerStarted: (state, _args) => ({ ...state, waitForCertManagerStep: inProgressStep() }),
        setInstallOperatorStarted: (state, _args) => ({ ...state, installOperatorStep: inProgressStep() }),
        setInstallOperatorSettingsStarted: (state, _args) => ({ ...state, installOperatorSettingsStep: inProgressStep() }),
        setWaitForControllerManagerStarted: (state, _args) => ({ ...state, waitForControllerManagerStep: inProgressStep() })
    }
};

export const vscode = getWebviewMessageContext<"aso">({
    checkSPRequest: null,
    installCertManagerRequest: null,
    installOperatorRequest: null,
    installOperatorSettingsRequest: null,
    waitForCertManagerRequest: null,
    waitForControllerManagerRequest: null
});