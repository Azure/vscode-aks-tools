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

export interface DeploymentResult {
    generatedFiles: string[];
}

export interface ModuleAnalysisResult {
    name: string;
    modulePath: string;
    language?: string;
    framework?: string;
    port?: number;
    buildCommand?: string;
    dependencies?: string[];
    entryPoint?: string;
}

export interface AnalyzeRepositoryResult {
    modules: ModuleAnalysisResult[];
    isMonorepo: boolean;
}

export interface ExistingFilesCheckResult {
    hasDockerfile: boolean;
    hasK8sManifests: boolean;
    dockerfilePath?: string;
    k8sManifestPaths?: string[];
}

export interface ModelQuickPickItem extends vscode.QuickPickItem {
    model: vscode.LanguageModelChat;
}
