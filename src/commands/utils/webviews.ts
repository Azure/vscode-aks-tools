import * as vscode from 'vscode';

export function createWebView(viewType: string, title: string): vscode.Webview {
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    return panel.webview;
}
