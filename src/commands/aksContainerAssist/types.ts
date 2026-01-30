import * as vscode from "vscode";

export interface ContainerAssistOptions {
    workspaceFolder: vscode.WorkspaceFolder;
    targetPath: string;
}

export enum ContainerAssistAction {
    GenerateDeployment = "generateDeployment",
    GenerateWorkflow = "generateWorkflow",
}

export interface ContainerAssistQuickPickItem extends vscode.QuickPickItem {
    action: ContainerAssistAction;
}

export interface ContainerAssistResult {
    succeeded: boolean;
    error?: string;
    generatedFiles?: string[];
}

export interface AnalyzeRepositoryResult {
    language?: string;
    framework?: string;
    port?: number;
    buildCommand?: string;
    startCommand?: string;
}
