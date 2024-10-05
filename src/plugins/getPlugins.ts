import { IActionContext } from "@microsoft/vscode-azext-utils";
import { createAKSClusterPlugin } from "./createAKS/createAKSClusterPlugin";
import { GetPluginsCommandResult } from "../types/@azure/AzureAgent";
import { generateKubectlCommandPlugin } from "./kubectlGeneration/generateKubectlCommandPlugin";
import { deployManifestPluginToAKSPlugin } from "./deployManifest/deployManifestToAKSPlugin";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function getPlugins(_context: IActionContext): Promise<GetPluginsCommandResult> {
    return { plugins: [
        createAKSClusterPlugin,
        generateKubectlCommandPlugin,
        deployManifestPluginToAKSPlugin
    ] };
}
