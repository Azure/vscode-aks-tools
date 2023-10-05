import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    clusterName: string
}

export type Subscription = {
    id: string,
    name: string
};

// From: https://github.com/Azure/ms-rest-azure-env/blob/7c7fc63c6f90f716366a267a8904db56d7098f33/lib/azureEnvironment.ts#L266-L346
export type AzureCloudName = "AzureCloud" | "AzureChinaCloud" | "AzureUSGovernment" | "AzureGermanCloud";

// From: https://github.com/Azure/azure-service-operator/blob/6990f7d5d34f7bcd1793f21e60f3ee8667f3047d/pkg/resourcemanager/config/env.go#L41-L46
export type ASOCloudName = "AzurePublicCloud" | "AzureChinaCloud" | "AzureUSGovernmentCloud" | "AzureGermanCloud";

export const azureToASOCloudMap: Record<AzureCloudName, ASOCloudName> = {
    AzureCloud: "AzurePublicCloud",
    AzureChinaCloud: "AzureChinaCloud",
    AzureUSGovernment: "AzureUSGovernmentCloud",
    AzureGermanCloud: "AzureGermanCloud"
};

export type InstallSettingsParams = {
    tenantId: string,
    subscriptionId: string,
    appId: string,
    appSecret: string,
    cloudName: AzureCloudName
}

export type ToVsCodeMsgDef = {
    checkSPRequest: {
        appId: string,
        appSecret: string
    },
    installCertManagerRequest: void,
    waitForCertManagerRequest: void,
    installOperatorRequest: void,
    installOperatorSettingsRequest: InstallSettingsParams
    waitForControllerManagerRequest: void
};

export type CommandResult = {
    command: string,
    stdout: string,
    stderr: string
};

export type InstallStepResult = {
    succeeded: boolean,
    errorMessage: string | null,
    commandResults: CommandResult[]
}

export type ToWebViewMsgDef = {
    checkSPResponse: InstallStepResult & {
        cloudName: AzureCloudName | null,
        tenantId: string | null,
        subscriptions: Subscription[]
    },
    installCertManagerResponse: InstallStepResult,
    waitForCertManagerResponse: InstallStepResult,
    installOperatorResponse: InstallStepResult,
    installOperatorSettingsResponse: InstallStepResult,
    waitForControllerManagerResponse: InstallStepResult
};

export type ASODefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;