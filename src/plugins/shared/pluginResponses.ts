import { MessageForLanguageModel, GitHubCopilotForAzureChatPluginResponse} from "./types";

// Create AKS cluster plugin
export const getAKSClusterPluginResponse = (): GitHubCopilotForAzureChatPluginResponse<MessageForLanguageModel> => {
    const messageForLanguageModel = {
        description: "To create a new AKS cluster, please use the Azure Kubernetes Service (AKS) extension in Visual Studio Code. This extension provides a guided experience, making it easier to configure your cluster. Follow the extension's instructions to complete the setup.",
        descriptionInstructions: "Focus on the description of the message, no need to add any other text.",
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
            "Select the Kubernetes manifest files in your application.",
            "Choose an existing cluster or create a new AKS Automatic or Dev/Test - (hint: add bullet) If you choose to create a new cluster, a page will guide you. (hint: add bullet) Once done, click 'Get Started' to continue deploying your application.",
            "Deploy your application."
        ],
        stepsInstructions: "Focus on the steps of the message, no need to add any other text."
    }

    return {
        messageForLanguageModel: messageForLanguageModel,
        commandID: "aks.aksDeployManifest",
        buttonLabel: "Get started"
    }
}