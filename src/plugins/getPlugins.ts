import { createAKSClusterPlugin } from "./createAKS/createAKSClusterPlugin";
import { GetPluginsCommandResult } from "../types/aiazure/AzureAgent";
import { deployManifestPluginToAKSPlugin } from "./deployManifest/deployManifestToAKSPlugin";

export async function getPlugins(): Promise<GetPluginsCommandResult> {
    return { plugins: [
        createAKSClusterPlugin,
        deployManifestPluginToAKSPlugin
    ] };
}
