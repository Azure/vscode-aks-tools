type GitHubCopilotForAzureChatPluginResponse = {
    messageForLanguageModel: string;
    buttonLabel: string;
    commandID: string;
}

type GitHubCopilotForAzureChatPluginResponseExtended<T> = GitHubCopilotForAzureChatPluginResponse & {
    arguments: T[] | undefined;
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
    return {
        messageForLanguageModel: `To execute this command, 1. Select an AKS cluster. 2. Run the kubectl command within the dedicated AKS extension panel. 3. make sure to review the command before running. ${response.message} ${response.code}. (Make sure to always show steps to the user first, then command, then chat button)`,
        commandID: "aks.openKubectlPanel",
        buttonLabel: "Execute kubectl command",
        arguments: [ response ]
    }
}

//Deploy manifest to AKS cluster plugin
export const getDeployManifestToAKSPluginResponse = (): GitHubCopilotForAzureChatPluginResponse => {
    return {
        messageForLanguageModel: `Absolutely, I'd be happy to assist you with deploying your application to an AKS cluster. To deploy an application to an AKS cluster, you will need to do the following: 1. Select the Kubernetes manifest files in your application. 2. Choose an existing cluster or create a new AKS Automatic or Dev/Test. 2.a. If you choose to create a new cluster, a page will guide you. 2.b. Once done, click 'Get Started' to continue deploying your application. 4. Deploy your application.`,
        commandID: "aks.deployManifest",
        buttonLabel: "Get started"
    }
}