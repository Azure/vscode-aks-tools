/**
 * Argo CD deployment plugin — GitHub Copilot skill.
 *
 * Registers a `LocalPluginEntry` that the Azure AI agent surfaces as a Copilot
 * chat function.  When the user asks something like:
 *   "How do I set up Argo CD on my AKS cluster?"
 *   "Create an Argo CD deployment for my cluster"
 *   "gitops deployment argo cd aks"
 *
 * …the agent invokes this skill, which replies with a rich message explaining
 * the Hollywood / GitOps principle and renders a chat command button that
 * launches aks.draftArgoCDDeployment.
 *
 * Reference: https://argo-cd.readthedocs.io/en/stable/
 */

import * as vscode from "vscode";
import {
    ILocalPluginHandler,
    LocalPluginArgs,
    LocalPluginEntry,
    LocalPluginManifest,
    ResponseForLanguageModelExtended,
} from "../../types/aiazure/AzureAgent";
import { getArgoCDDeploymentPluginResponse } from "../shared/pluginResponses";

// ---------------------------------------------------------------------------
// Manifest — describes this skill to the Copilot agent runtime
// ---------------------------------------------------------------------------

export const argoCDDeploymentFunctionName = "create_argocd_deployment";

export const argoCDDeploymentPluginManifest: LocalPluginManifest = {
    name: "argoCDDeploymentPlugin",
    version: "1.0.0",
    functions: [
        {
            name: argoCDDeploymentFunctionName,
            parameters: [],
            returnParameter: {
                type: "object",
            },
            willHandleUserResponse: false,
        },
    ],
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleArgoCDDeployment(): Promise<ResponseForLanguageModelExtended> {
    const { messageForLanguageModel, buttonLabel, commandID } = getArgoCDDeploymentPluginResponse();

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

const argoCDDeploymentPluginHandler: ILocalPluginHandler = {
    execute: async (args: LocalPluginArgs) => {
        const pluginRequest = args.localPluginRequest;

        if (pluginRequest.functionName === argoCDDeploymentFunctionName) {
            const { responseForLanguageModel, chatResponseParts } = await handleArgoCDDeployment();
            return { responseForLanguageModel, chatResponseParts };
        }

        return {
            status: "error",
            message: `Unrecognized function: ${pluginRequest.functionName}`,
        };
    },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const argoCDDeploymentPlugin: LocalPluginEntry = {
    manifest: argoCDDeploymentPluginManifest,
    handler: argoCDDeploymentPluginHandler,
};
