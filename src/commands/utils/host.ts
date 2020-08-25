import * as vscode from 'vscode';
import { registerCommand } from 'vscode-azureextensionui';
import { reporter } from '../utils/reporter';

const meta = require('../../../package.json');

export async function longRunning<T>(title: string, action: () => Promise<T>): Promise<T> {
    const options = {
        location: vscode.ProgressLocation.Notification,
        title: title
    };
    return await vscode.window.withProgress(options, (_) => action());
}

export function getExtensionPath(): string | undefined {
    const publisherName = `${meta.publisher}.${meta.name}`;
    const vscodeExtensionPath = vscode.extensions.getExtension(publisherName)?.extensionPath;

    if (!vscodeExtensionPath) {
        vscode.window.showInformationMessage('No Extension path found.');
        return;
    }
    return vscodeExtensionPath;
}

export function registerCommandWithTelemetry(
    commandId: string,
    callback: any
) {

    reporter.sendTelemetryEvent("command", { command: commandId });
    registerCommand(commandId, callback);
}
