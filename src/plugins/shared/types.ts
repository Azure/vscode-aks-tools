export type ClusterPreference = {
    subscriptionId: string;
    clusterName: string;
    clusterId: string;
    resourceGroup: string;
    kubeConfigYAML: string;
};

export type MessageForLanguageModel = {
    description?: string;
    descriptionInstructions?: string;
    steps?: string[];
    stepsInstructions?: string;
    chatResponseInstructions?: string;
}

export type GitHubCopilotForAzureChatPluginResponse<T> = {
    messageForLanguageModel: T;
    buttonLabel: string;
    commandID: string;
}

export type GitHubCopilotForAzureChatPluginResponseExtended<E, T> = GitHubCopilotForAzureChatPluginResponse<E> & {
    arguments: T[] | undefined;
}

export type GitHubCopilotForAzureChatPluginErrorResponse<T> = {
    messageForLanguageModel: T;
}
