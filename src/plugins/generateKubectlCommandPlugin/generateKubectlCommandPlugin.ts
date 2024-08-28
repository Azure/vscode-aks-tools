import {
    AgentRequest,
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    ResponseForLanguageModelExtended,
} from "copilot-for-azure-vscode-api";
import * as vscode from "vscode";
import { getCopilotClient } from "../../commands/utils/copilot";
import { failed } from "../../commands/utils/errorable";
import { getReadySessionProvider } from "../../auth/azureAuth";
import * as k8s from "vscode-kubernetes-tools-api";
import { getAssetContext } from "../../assets";
import { CurrentClusterContext } from "../../commands/utils/clusters";

const generateKubectlCommandFunctionName = "generateKubectlCommand";
type Parameters = {
    commandGenerationIntent: string;
};

const generateKubectlCommandPluginManifest: LocalPluginManifest = {
    name: "generateKubectlCommandPlugin",
    version: "1.0.0",
    functions: [
        {
            name: generateKubectlCommandFunctionName,
            description: "generate kubectl command for AKS cluster for users to check in kubectl panel in VSCode",
            parameters: [
                {
                    name: "commandGenerationIntent",
                    description: "A natural language description of what kubectl command to generate for the user",
                    type: "string",
                    required: true,
                },
            ],
            returnParameter: null,
            willHandleUserResponse: false,
        },
    ],
    applicableTopicScopes: []
};

/**
 */
interface RunCommandOptions {
    response: string;
    history: readonly (vscode.ChatResponseTurn | vscode.ChatRequestTurn)[];
}

/**
 */
export type RunCommandArguments = [ RunCommandOptions | undefined];
export const RUNCOMMANDID = 'aks.aksRunKubectlCommandsForCopilot';

async function handleKubectlCommandGeneration(agentRequest: AgentRequest, commandGenerationIntent:string, currentCluster: CurrentClusterContext): Promise<ResponseForLanguageModelExtended> {
    console.log("agentRequest: ", agentRequest);

    const sessionProvider = await getReadySessionProvider();

    if (failed(sessionProvider)) {
        return {responseForLanguageModel: {text: "Failed to get session provider."}};
    }

    const client = getCopilotClient(sessionProvider.result);

    const request = await client.sendRequest({
        intent: `Kubectl command generation for AKS Cluster: ${currentCluster.clusterName}`,
        message: `Generate single most relevant **kubectl** command for an AKS cluster: ${commandGenerationIntent}`,
        scenario: "Azure Kubernetes Service"
    });

    if (failed(request) || !request.result.response) {
        return {responseForLanguageModel: {text : "Failed to generate kubectl command."}};
    }

    return {
        responseForLanguageModel: {text :`${request.result.response.text}`},
        chatResponseParts : [
            new vscode.ChatResponseCommandButtonPart({
                title: vscode.l10n.t("$(terminal) Execute kubectl command"),
                command: RUNCOMMANDID,
                arguments: [
                    /* options */ { response: request.result.response.text, history: agentRequest.context.history },
                ] satisfies RunCommandArguments
            }),
        ]
    };
}

const generateKubectlCommandPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs<typeof generateKubectlCommandFunctionName, Parameters>) => {
        const pluginRequest = args.localPluginRequest;
        const config = await k8s.extension.configuration.v1;
        const kubectl = await k8s.extension.kubectl.v1;

        const asset = getAssetContext();

        const currentCluster = (await asset.globalState.get("currentCluster")) as string;

        if (!currentCluster) {
            vscode.window.showErrorMessage("AKS cluster is not set. Please set the AKS cluster first.");
            return { status: "error", message: "AKS cluster is not set. Please set the AKS cluster first." };
        }

        const parsedCurrentCluster = JSON.parse(currentCluster) as CurrentClusterContext;

        if (!config.available) {
            vscode.window.showWarningMessage(`Cluster configuration is unavailable.`);
            return { status: "error", message: "Cluster configuration is unavailable." };
        }

        if (!kubectl.available) {
            vscode.window.showWarningMessage(`Kubectl is unavailable.`);
            return { status: "error", message: "Kubectl is unavailable." };
        }

        const { commandGenerationIntent } = args.localPluginRequest.parameters;

        if (pluginRequest.functionName === generateKubectlCommandFunctionName) {
            const { responseForLanguageModel, chatResponseParts } = await handleKubectlCommandGeneration(args.agentRequest, commandGenerationIntent, parsedCurrentCluster);
            return { responseForLanguageModel, chatResponseParts };
        }

        return {
            status: "error",
            message: "Unrecognized command.",
        };
    },
};

export const generateKubectlCommandPlugin: LocalPluginEntry = {
    manifest: generateKubectlCommandPluginManifest,
    handler: generateKubectlCommandPluginHandler,
};
