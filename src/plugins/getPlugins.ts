import { createAKSClusterPlugin } from "./createAKS/createAKSClusterPlugin";
import { GetPluginsCommandResult } from "../types/aiazure/AzureAgent";
import { deployManifestPluginToAKSPlugin } from "./deployManifest/deployManifestToAKSPlugin";
import { generateKubectlCommandPlugin } from "./kubectlGeneration/generateKubectlCommandPlugin";

export async function getPlugins(): Promise<GetPluginsCommandResult> {
    return {
        plugins: [
            createAKSClusterPlugin,
            deployManifestPluginToAKSPlugin,
            generateKubectlCommandPlugin
        ]
    };
}
