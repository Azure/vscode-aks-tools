type GitHubCopilotForAzureChatPluginResponse = {
    messageForLanguageModel: string;
    buttonLabel: string;
    commandID: string;
}

type GitHubCopilotForAzureChatPluginResponseExtended = GitHubCopilotForAzureChatPluginResponse & {
    arguments: any[] | undefined;
}

// Create AKS cluster plugin
export const getAKSClusterPluginResponse = (): GitHubCopilotForAzureChatPluginResponse => {
    return {
        messageForLanguageModel: "To create a new AKS cluster, please use the Azure Kubernetes Service (AKS) extension in Visual Studio Code. This extension provides a guided experience, making it easier to configure your cluster. Follow the extension's instructions to complete the setup.",
        commandID: "aks.aksCreateClusterFromCopilot",
        buttonLabel: "Get started"
    }
}

// Kubectl command generation plugin
export interface CommandResponse {
    status: string;
    message: string;
    code: string;
}

export interface CommandOptions {
    response: CommandResponse;
}

type CommandArguments = [CommandOptions | undefined]

export const getKubectlCommandPluginResponse = (response: CommandResponse): GitHubCopilotForAzureChatPluginResponseExtended => {
    return {
        messageForLanguageModel: response.message,
        commandID: "aks.openKubectlPanel",
        buttonLabel: "Execute kubectl command",
        arguments: [ 
           /* options */ { response }
         ] satisfies CommandArguments
    }
}