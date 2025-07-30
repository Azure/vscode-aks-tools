import * as vscode from 'vscode';
import { failed } from '../utils/errorable';
import { getAKSMCPServerBinaryPath } from '../utils/helper/mcpServerDownloadHelper';

export async function addMcpServerToUserSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration();


    // Read current "mcp.servers" or initialize it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = config.get<{ [key: string]: any }>('mcp.servers') || {};

    // This extension controls the version of mcp-server used, so that:
    // 1. We don't need to rely on the user having previously downloaded it, and
    // 2. This workflow doesn't get broken by mcp-server behaviour changes between versions
    const mcpServerPath = await getAKSMCPServerBinaryPath();
    if (failed(mcpServerPath)) {
        vscode.window.showErrorMessage(`Failed to download MCP server: ${mcpServerPath.error}`);
        return;
    }

    // Add or overwrite the server entry
    const newServerConfig = {
        command: mcpServerPath.result,
        args: ["--transport", "stdio"]
    };

    current["AKS MCP"] = newServerConfig;

    // Save it back to user settings.json
    await config.update(
        'mcp.servers',
        current,
        vscode.ConfigurationTarget.Global // Use Global to persist in user settings.json
    );

    vscode.window.showInformationMessage('MCP server AKS MCP added to settings.');
}