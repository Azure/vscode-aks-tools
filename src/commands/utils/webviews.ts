import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as vscode from 'vscode';
import { ClusterStartStopState } from './clusters';

//
// Register the custom HTML handlers. Having these registered the first time the module is imported means
// they are registered one time, rather than each time they are used.
//

htmlhandlers.registerHelper('breaklines', (text: any): any => {
    if (text) {
        text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    }
    return text;
});

export function createWebView(viewType: string, title: string): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    return panel;
}

export function getResourceUri(webview: vscode.Webview, vscodeExtensionPath: string, folder: string, filename: string): vscode.Uri {
    const onDiskPath = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', folder, filename));
    return webview.asWebviewUri(onDiskPath);
}

export function getRenderedContent(templateUri: vscode.Uri, data: object): string {
    const templateContent = fs.readFileSync(templateUri.fsPath, 'utf8').toString();

    const template = htmlhandlers.compile(templateContent);
    return template(data);
}

htmlhandlers.registerHelper('showStartStopButton', (value: any): boolean => {
    if (value === ClusterStartStopState.Starting || value === ClusterStartStopState.Stopping ) {
        return false;
    }

    return true;
});

htmlhandlers.registerHelper('startStopClusterValue', (value: any): string => {
    if (value === ClusterStartStopState.Stopped) {
        return "Start";
    }
    return "Stop";
});
