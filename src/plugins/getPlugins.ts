import { createAKSClusterPlugin } from "./createAKS/createAKSClusterPlugin";
import { GetPluginsCommandResult } from "../types/aiazure/AzureAgent";

export async function getPlugins(): Promise<GetPluginsCommandResult> {
    return { plugins: [createAKSClusterPlugin] };
}
