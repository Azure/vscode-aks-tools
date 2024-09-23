import * as vscode from "vscode";
import { ILocalPluginHandler, LocalPluginArgs, LocalPluginEntry, LocalPluginManifest, ResponseForLanguageModelExtended } from "copilot-for-azure-vscode-api";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../../commands/utils/errorable";

const createAKSClusterFunctionName = "createAKSCluter";
export const createAKSClusterPluginManifest: LocalPluginManifest = {
    name: "createAKSClusterPlugin",
    version: "1.0.0",
    functions: [
        {
            name: createAKSClusterFunctionName,
            parameters: [],
            returnParameter: null,
            willHandleUserResponse: false,
        }
    ]
};

export const CREATE_AKS_COMMANDID = 'aks.aksCreateClusterFromCopilot';

async function handleCreateAKS(): Promise<ResponseForLanguageModelExtended> {

    const result = "Create a new cluster using the Azure Kubernetes Service extension for VS Code. This extension provides a guided experience to create a new AKS cluster.";
    return {
        responseForLanguageModel: {result},
        chatResponseParts : [
            new vscode.ChatResponseCommandButtonPart({
                title: vscode.l10n.t("Create an AKS cluster"),
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