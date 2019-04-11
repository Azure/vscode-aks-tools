import * as vscode from 'vscode';
import { AKSTreeProvider } from './aks-tree';

const explorer = new AKSTreeProvider();

export function activate(context: vscode.ExtensionContext) {
    const disposables = [
        vscode.window.registerTreeDataProvider("aks.aksExplorer", explorer)
    ];

    context.subscriptions.push(...disposables);
}
