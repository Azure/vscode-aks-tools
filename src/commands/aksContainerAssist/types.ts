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

/**
 * Result of the deployment file generation workflow
 */
export interface DeploymentResult {
    generatedFiles: string[];
}

/**
 * Module information extracted from repository analysis
 */
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

/**
 * Result of the repository analysis - supports monorepos with multiple modules
 */
export interface AnalyzeRepositoryResult {
    modules: ModuleAnalysisResult[];
    isMonorepo: boolean;
}
