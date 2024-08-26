import {
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
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
            returnParameter: {
                description: "Return message of the command execution.",
                type: "string",
            },
            willHandleUserResponse: false,
        },
    ],
};

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
            const sessionProvider = await getReadySessionProvider();

            if (failed(sessionProvider)) {
                return {
                    status: "error",
                    message: sessionProvider.error,
                };
            }

            const client = getCopilotClient(sessionProvider.result);

            const request = await client.sendRequest({
                intent: `Kubectl command generation for AKS Cluster: ${parsedCurrentCluster.clusterName}`,
                message: commandGenerationIntent,
                scenario: "Azure Kubernetes Service",
                requestId: args.agentRequest.requestId,
            });

            if (failed(request)) {
                return {
                    status: "error",
                    message: "Failed to generate kubectl command.",
                };
            }

            const button = {
                title: "Execute in kubectl panel",
                command: "aks.aksRunKubectlCommandsForCopilot",
            } as vscode.Command;

            args.agentRequest.responseStream.button(button);
            return { status: "success", message: request.result.response, parts: button ? [button] : [] };
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
