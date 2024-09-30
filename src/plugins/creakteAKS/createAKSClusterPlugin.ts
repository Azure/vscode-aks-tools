import * as vscode from "vscode";
import { ILocalPluginHandler, LocalPluginArgs, LocalPluginEntry, LocalPluginManifest, ResponseForLanguageModelExtended } from "../../types/@azure/AzureAgent";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../../commands/utils/errorable";

const createAKSClusterFunctionName = "create_aks_cluster";
export const createAKSClusterPluginManifest: LocalPluginManifest = {
    name: "createAKSClusterPlugin",
    version: "1.0.0",
    functions: [
        {
            name: createAKSClusterFunctionName,
            parameters: [],
            returnParameter: {
                type: "object"
            },
            willHandleUserResponse: false,
        }
    ]
};

export const CREATE_AKS_COMMANDID = 'aks.aksCreateClusterFromCopilot';

async function handleCreateAKS(): Promise<ResponseForLanguageModelExtended> {

    const result = "To create a new AKS cluster, please use the Azure Kubernetes Service (AKS) extension in Visual Studio Code. This extension provides a guided experience, making it easier to configure your cluster. Follow the extension's instructions to complete the setup.";
    return {
        responseForLanguageModel: {result},
        chatResponseParts : [
            new vscode.ChatResponseCommandButtonPart({
                title: vscode.l10n.t("Get started"),
                command: CREATE_AKS_COMMANDID,
                arguments: []
            }),
        ]
    };
}

const createAKSClusterPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs) => {
        const pluginRequest = args.localPluginRequest;
        const sessionProvider = await getReadySessionProvider();   

        if(failed(sessionProvider)) {
            return { status: "error", message: sessionProvider.error };
        }

        if (pluginRequest.functionName === createAKSClusterFunctionName) {
            const { responseForLanguageModel, chatResponseParts } = await handleCreateAKS();
            return { responseForLanguageModel, chatResponseParts };
        }

        return {
            status: "error",
            message: "Unrecognized command."
        }
    }
};

export const createAKSClusterPlugin: LocalPluginEntry = {
    manifest: createAKSClusterPluginManifest,
    handler: createAKSClusterPluginHandler,
};