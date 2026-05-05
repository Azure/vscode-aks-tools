import * as vscode from "vscode";
import { analyzeRepo, formatErrorForLLM } from "containerization-assist-mcp/sdk";
import { Errorable } from "../../../commands/utils/errorable";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";

export interface ModuleAnalysis {
    name?: string;
    modulePath?: string;
    language?: string;
    framework?: string;
    port?: number;
    dependencies?: string[];
    entryPoint?: string;
}

export interface AnalysisResult {
    modules: ModuleAnalysis[];
    isMonorepo: boolean;
}

export async function analyzeProject(
    projectPath: string,
    _lmClient: LMClient,
    token: vscode.CancellationToken,
): Promise<Errorable<AnalysisResult>> {
    try {
        const result = await analyzeRepo({ repositoryPath: projectPath }, { signal: tokenToAbortSignal(token) });

        if (!result.ok) {
            return { succeeded: false, error: formatErrorForLLM(result.error, result.guidance) };
        }

        const modules: ModuleAnalysis[] = (result.value.modules || []).map((module) => ({
            name: module.name,
            modulePath: module.modulePath,
            language: module.language,
            framework: module.frameworks?.[0]?.name,
            port: module.ports?.[0],
            dependencies: module.dependencies,
            entryPoint: module.entryPoint,
        }));

        return {
            succeeded: true,
            result: {
                modules,
                isMonorepo: result.value.isMonorepo ?? modules.length > 1,
            },
        };
    } catch (error) {
        return { succeeded: false, error: String(error) };
    }
}

export function tokenToAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
        controller.abort();
    } else {
        token.onCancellationRequested(() => controller.abort());
    }

    return controller.signal;
}
