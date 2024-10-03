import * as vscode from "vscode";
import {
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    ResponseForLanguageModelExtended,
} from "../../types/aiazure/AzureAgent";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../../commands/utils/errorable";
import { getAKSClusterPluginResponse } from "../shared/pluginResponses";

const createAKSClusterFunctionName = "create_aks_cluster";
export const createAKSClusterPluginManifest: LocalPluginManifest = {
    name: "createAKSClusterPlugin",
    version: "1.0.0",
    functions: [
        {
            name: createAKSClusterFunctionName,
            parameters: [],
            returnParameter: {
                type: "object",
            },
            willHandleUserResponse: false,
        },
    ],
};

async function handleCreateAKS(): Promise<ResponseForLanguageModelExtended> {
    const { messageForLanguageModel, buttonLabel, commandID } = getAKSClusterPluginResponse();

    return {
        responseForLanguageModel: { messageForLanguageModel },
        chatResponseParts: [
            new vscode.ChatResponseCommandButtonPart({
                title: vscode.l10n.t(buttonLabel),
                command: commandID,
                arguments: [],
            }),
        ],
    };
}

const createAKSClusterPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs) => {
        const pluginRequest = args.localPluginRequest;
        const sessionProvider = await getReadySessionProvider();

        if (failed(sessionProvider)) {
            return { status: "error", message: sessionProvider.error };
        }

        if (pluginRequest.functionName === createAKSClusterFunctionName) {
            const { responseForLanguageModel, chatResponseParts } = await handleCreateAKS();
            return { responseForLanguageModel, chatResponseParts };
        }

        return {
            status: "error",
            message: "Unrecognized command.",
        };
    },
};

export const createAKSClusterPlugin: LocalPluginEntry = {
    manifest: createAKSClusterPluginManifest,
    handler: createAKSClusterPluginHandler,
};
