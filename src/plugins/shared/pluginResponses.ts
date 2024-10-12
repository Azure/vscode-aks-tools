import { Failed } from "../../commands/utils/errorable";
import { GitHubCopilotForAzureChatPluginResponse, MessageForLanguageModel, GitHubCopilotForAzureChatPluginResponseExtended, GitHubCopilotForAzureChatPluginErrorResponse } from "./types";

// Create AKS cluster plugin
export const getAKSClusterPluginResponse = (): GitHubCopilotForAzureChatPluginResponse<MessageForLanguageModel> => {
    const messageForLanguageModel = {
        description: "To create a new AKS cluster, please use the Azure Kubernetes Service (AKS) extension in Visual Studio Code. This extension provides a guided experience, making it easier to configure your cluster. Follow the extension's instructions to complete the setup.",
        descriptionInstructions: "Focus on the description of the message, no need to add any other text. Also mention that the creation of an AKS cluster might take a few minutes.",
    }

    return {
        messageForLanguageModel: messageForLanguageModel,
        commandID: "aks.aksCreateClusterFromCopilot",
        buttonLabel: "Get started"
    }
}

//Deploy manifest to AKS cluster plugin
export const getDeployManifestToAKSPluginResponse = (): GitHubCopilotForAzureChatPluginResponse<MessageForLanguageModel> => {
    const messageForLanguageModel = {
        description: "To deploy an application to an AKS cluster, you will need to do the following:",
        steps: [
            "1. Select the Kubernetes manifest *file* in your application.",
            "2. Choose an existing cluster or create a new AKS Automatic or Dev/Test - (hint: add bullet) If you choose to create a new cluster, a page will guide you. (hint: add bullet) Once done, click 'Get Started' to continue deploying your application.",
            "3. Deploy your application."
        ],
        stepsInstructions: "Focus on the steps of the message, no need to add any other text."
    }

    return {
        messageForLanguageModel: messageForLanguageModel,
        commandID: "aks.aksDeployManifest",
        buttonLabel: "Get started"
    }
};

// Kubectl command generation plugin
export interface CommandResponse {
    status: string;
    message: string;
    code: string;
}

type MessageForLanguageModelForKubectlCommandPlugin = MessageForLanguageModel & { kubectlCommand: string; kubectlCommandInstructions: string; }

export const getKubectlCommandPluginResponse = (response: CommandResponse): GitHubCopilotForAzureChatPluginResponseExtended<MessageForLanguageModelForKubectlCommandPlugin, CommandResponse> => {
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
        commandID: "aks.aksOpenKubectlPanel",
        buttonLabel: "Execute kubectl command",
        arguments: [response]
    }
}

export const getKubectlCommandPluginErrorResponse = (response: Failed): GitHubCopilotForAzureChatPluginErrorResponse<MessageForLanguageModel> => {
    const messageForLanguageModel = {
        description: response.error,
        desciptionInstructions: "Display error message *as is*.",
    }
    return {
        messageForLanguageModel: messageForLanguageModel,
    }
}