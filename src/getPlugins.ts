import { type IActionContext } from "@microsoft/vscode-azext-utils";
import { GetPluginsCommandResult } from "copilot-for-azure-vscode-api";
import { deployAppToAKSPlugin } from "./plugins/deployAppToAKSPlugin/deployAppToAKSPlugin";
import { generateKubectlCommandPlugin } from "./plugins/generateKubectlCommandPlugin/generateKubectlCommandPlugin";
import { setClusterContextPlugin } from "./plugins/setClusterContextPlugin/setClusterContextPlugin";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getPlugins(_actionContext: IActionContext): Promise<GetPluginsCommandResult> {
    return {
        plugins: [
            deployAppToAKSPlugin,
            generateKubectlCommandPlugin,
            setClusterContextPlugin
        ]
    };
}