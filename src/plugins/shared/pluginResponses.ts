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

//Deploy manifest to AKS cluster plugin
export const getDeployManifestToAKSPluginResponse = (): GitHubCopilotForAzureChatPluginResponse => {
    return {
        messageForLanguageModel: `Absolutely, I'd be happy to assist you with deploying your application to an AKS cluster. To deploy an application to an AKS cluster, you will need to do the following: 1. Select the Kubernetes manifest files in your application. 2. Choose an existing cluster or create a new AKS Automatic or Dev/Test. 2.a. If you choose to create a new cluster, a page will guide you. 2.b. Once done, click 'Get Started' to continue deploying your application. 4. Deploy your application.`,
        commandID: "aks.aksDeployManifest",
        buttonLabel: "Get started"
    }
}