import * as vscode from 'vscode';
import { Errorable } from './errorable';

const meta = require('../../../package.json');

export async function longRunning<T>(title: string, action: () => Promise<T>): Promise<T> {
    const options = {
        location: vscode.ProgressLocation.Notification,
        title: title
    };
    return await vscode.window.withProgress(options, (_) => action());
}

export function getExtensionPath(): Errorable<string> {
    const publisherName = `${meta.publisher}.${meta.name}`;
    const vscodeExtensionPath = vscode.extensions.getExtension(publisherName)?.extensionPath;
    if (!vscodeExtensionPath) {
        return { succeeded: false, error: 'No Extension path found.' };
    }

    return { succeeded: true, result: vscodeExtensionPath };
}
