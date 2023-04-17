import * as vscode from 'vscode';
import { Errorable, map as errmap } from './errorable';

const meta = require('../../../package.json');

export async function longRunning<T>(title: string, action: () => Promise<T>): Promise<T> {
    const options = {
        location: vscode.ProgressLocation.Notification,
        title: title
    };
    return await vscode.window.withProgress(options, (_) => action());
}

export function getExtension(): Errorable<vscode.Extension<vscode.ExtensionContext>> {
    const publisherName = `${meta.publisher}.${meta.name}`;
    const extension = vscode.extensions.getExtension(publisherName);
    return extension ? { succeeded: true, result: extension } : { succeeded: false, error: `Extension not found for ${publisherName}` };
}

export function getExtensionPath(): Errorable<string> {
    return errmap(getExtension(), e => e.extensionPath);
}
