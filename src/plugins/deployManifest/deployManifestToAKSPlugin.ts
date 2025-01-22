import * as vscode from "vscode";
import {
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    ResponseForLanguageModelExtended,
} from "../../types/aiazure/AzureAgent";
import { getDeployManifestToAKSPluginResponse } from "../shared/pluginResponses";

const deployManifestToAKSClusterFunctionName = "deploy_manifest_aks_cluster";
export const deployManifestToAKSPluginManifest: LocalPluginManifest = {
    name: "deployManifestToAKSPlugin",
    version: "1.0.0",
    functions: [
        {
            name: deployManifestToAKSClusterFunctionName,
            parameters: [],
            returnParameter: {
                type: "object",
            },
            willHandleUserResponse: false,
        },
    ],
};

async function handleDeployManifestToAKS(): Promise<ResponseForLanguageModelExtended> {
    const { messageForLanguageModel, buttonLabel, commandID } = getDeployManifestToAKSPluginResponse();

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

const deployManifestToAKSPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === deployManifestToAKSClusterFunctionName) {
            const { responseForLanguageModel, chatResponseParts } = await handleDeployManifestToAKS();
            return { responseForLanguageModel, chatResponseParts };
        }

        return {
            status: "error",
            message: "Unrecognized command.",
        };
    },
};

export const deployManifestPluginToAKSPlugin: LocalPluginEntry = {
    manifest: deployManifestToAKSPluginManifest,
    handler: deployManifestToAKSPluginHandler,
};
