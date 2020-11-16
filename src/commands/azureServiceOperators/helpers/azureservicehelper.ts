import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';

export function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    outputCertManagerResult: k8s.KubectlV1.ShellResult | undefined,
    outputIssuerCertResult: k8s.KubectlV1.ShellResult | undefined,
    outputSPJSONResult: any | undefined,
    outputASOSettingResult: k8s.KubectlV1.ShellResult | undefined,
    output: k8s.KubectlV1.ShellResult | undefined
): string {
    const stylePathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'azureserviceoperator', 'azureserviceoperator.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const commandCertManagerOutput = outputCertManagerResult ? outputCertManagerResult.stderr + outputCertManagerResult.stdout : undefined;
    const commandIssuerOutput = outputIssuerCertResult ? outputIssuerCertResult.stderr + outputIssuerCertResult.stdout : undefined;
    const commandASOSettingsOutput = outputASOSettingResult ? outputASOSettingResult.stderr + outputASOSettingResult.stdout : undefined;
    const commandOutput = output ? output.stderr + output.stdout : undefined;

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        storageAccName: "test",
        name: clustername,
        certManagerOutput: commandCertManagerOutput,
        issuerOutput: commandIssuerOutput,
        asoSettingsOutput: commandASOSettingsOutput,
        spJSONResult: outputSPJSONResult,
        output: commandOutput,
        outputCode: output?.code
    };
    const webviewcontent = template(data);

    return webviewcontent;
}

export function htmlHandlerRegisterHelper() {
    htmlhandlers.registerHelper("equalsZero", equalsZero);
    htmlhandlers.registerHelper("isNonZeroNumber", isNonZeroNumber);
    htmlhandlers.registerHelper("breaklines", breaklines);
}

function equalsZero(value: number): boolean {
    return value === 0;
}

function isNonZeroNumber(value: any): boolean {
    if (isNaN(Number(value))) {
        return false;
    }
    return value !== 0;
}

function breaklines(text: any): any {
    // text = Handlebars.Utils.escapeExpression(text);
    text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    return text;
}