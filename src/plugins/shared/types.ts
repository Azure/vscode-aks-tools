import { ManagedClusterSKU } from "@azure/arm-containerservice";

export type ClusterPreference = {
    subscriptionId: string;
    clusterName: string;
    clusterId: string;
    resourceGroup: string;
    kubeConfigYAML: string;
    sku?: ManagedClusterSKU;
};

export type MessageForLanguageModel = {
    description?: string;
    descriptionInstructions?: string;
    steps?: string[];
    stepsInstructions?: string;
    chatResponseInstructions?: string;
};

export type GitHubCopilotForAzureChatPluginResponse<T> = {
    messageForLanguageModel: T;
    buttonLabel: string;
    commandID: CommandIdForPluginResponse;
};

export type GitHubCopilotForAzureChatPluginResponseExtended<E, T> = GitHubCopilotForAzureChatPluginResponse<E> & {
    arguments: T[] | undefined;
};

export type GitHubCopilotForAzureChatPluginErrorResponse<T> = {
    messageForLanguageModel: T;
};

export type CommandIdForPluginResponse =
    | "aks.aksDeployManifest"
    | "aks.aksOpenKubectlPanel"
    | "aks.aksCreateClusterFromCopilot";
