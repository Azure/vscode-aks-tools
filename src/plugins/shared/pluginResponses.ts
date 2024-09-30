type GitHubCopilotForAzureChatPluginResponse = {
    messageForLanguageModel: string;
    buttonLabel: string;
    commandID: string;
}

// Create AKS cluster plugin
export const getAKSClusterPluginResponse = (): GitHubCopilotForAzureChatPluginResponse => {
    return {
        messageForLanguageModel: "To create a new AKS cluster, please use the Azure Kubernetes Service (AKS) extension in Visual Studio Code. This extension provides a guided experience, making it easier to configure your cluster. Follow the extension's instructions to complete the setup.",
        commandID: "aks.aksCreateClusterFromCopilot",
        buttonLabel: "Get started"
    }
}