import { GetPluginsCommandResult } from "copilot-for-azure-vscode-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { createAKSClusterPlugin } from "./creakteAKS/createAKSClusterPlugin";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function getPlugins(_context: IActionContext): Promise<GetPluginsCommandResult> {
    return { plugins: [
        createAKSClusterPlugin
    ] };
}
