import * as vscode from "vscode";
import { failed } from "../utils/errorable";
import { getAKSMCPServerBinaryPath } from "../utils/helper/mcpServerDownloadHelper";

// Registers the AKS MCP server with VS Code. Works in remote setups (WSL,
// Remote-SSH, Dev Containers). Writing directly to user `mcp.servers`
// doesn't work for these remote scenarios.
export function registerAksMcpServerProvider(context: vscode.ExtensionContext): void {
    // Provider for the AKS MCP server (identified by "AKS MCP").
    const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
        // Binary path is left empty; resolveMcpServerDefinition populates it below.
        provideMcpServerDefinitions: () => [
            new vscode.McpStdioServerDefinition("AKS MCP", "", ["--transport", "stdio", ...getEnabledComponentsArgs()]),
        ],
        // Downloads binary then points the server at it.
        resolveMcpServerDefinition: async (server) => {
            const binary = await getAKSMCPServerBinaryPath();
            if (failed(binary)) {
                throw new Error(`Failed to download AKS MCP server: ${binary.error}`);
            }
            server.command = binary.result;
            server.args = ["--transport", "stdio", ...getEnabledComponentsArgs()];
            return server;
        },
    };

    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider("aks-mcp", provider));
}

function getEnabledComponentsArgs(): string[] {
    const v = vscode.workspace.getConfiguration("aks.aksmcpserver").get<string>("enabledComponents", "").trim();
    return v ? ["--enabled-components", v] : [];
}
