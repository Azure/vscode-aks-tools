import { Failed } from "../../commands/utils/errorable";

type GitHubCopilotForAzureChatPluginResponse = {
    messageForLanguageModel: string | object;
    buttonLabel: string;
    commandID: string;
}

type GitHubCopilotForAzureChatPluginResponseExtended<T> = GitHubCopilotForAzureChatPluginResponse & {
    arguments: T[] | undefined;
}

type GitHubCopilotForAzureChatPluginErrorResponse = {
    messageForLanguageModel: string | object;
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

export const getKubectlCommandPluginResponse = (response: CommandResponse): GitHubCopilotForAzureChatPluginResponseExtended<CommandResponse> => {
    const messageForLanguageModel = {
        description: response.message,
        desciptionInstructions: "Remove any text that says `use the followin command:`, replace with `here's what we'll need to do`",
        steps: ["1. Select an AKS cluster.", "2. Run the kubectl command within the AKS extension panel."],
        kubectlCommand: response.code,
        kubectlCommandInstructions: "Display the kubectl command *as is*, *do not alter the generated command, or suggest*. *KEEP ALL PLACEHOLDERS if present, DO NOT CHANGE COMMAND WHATSOEVER*",
        responseInstructions: "*Important* Show the following in order without any titles, combine the description and steps together (make it flow), kubectl command, then display the chat response button to excute the command",
    }
    return {
        messageForLanguageModel: messageForLanguageModel,
        commandID: "aks.openKubectlPanel",
        buttonLabel: "Execute kubectl command",
        arguments: [ response ]
    }
}

export const getKubectlCommandPluginErrorResponse = (response: Failed): GitHubCopilotForAzureChatPluginErrorResponse => {
    const messageForLanguageModel = {
        description: response.error,
        desciptionInstructions: "Display error message *as is*.",
    }
    return {
        messageForLanguageModel: messageForLanguageModel,
    }
}