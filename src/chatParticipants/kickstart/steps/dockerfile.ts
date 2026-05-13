import * as path from "path";
import * as vscode from "vscode";
import { generateDockerfile as sdkGenerateDockerfile, formatErrorForLLM } from "containerization-assist-mcp/sdk";
import { DOCKERFILE_SYSTEM_PROMPT, buildDockerfileUserPrompt } from "../../../commands/aksContainerAssist/prompts";
import { PROJECT_TOOLS, handleToolCall } from "../../../commands/aksContainerAssist/tools";
import { extractContent } from "../../../commands/aksContainerAssist/contentParser";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { Errorable, failed } from "../../../commands/utils/errorable";
import { AnalysisResult, ModuleAnalysis, tokenToAbortSignal } from "./analyze";
import { StagedFileManager } from "../stagedFileManager";
import { StagedFile } from "../state";

export type OnFileStaged = (file: StagedFile, allStaged: StagedFile[]) => void;

/**
 * Returns the staging path prefix for files belonging to `module`.
 * Returns "" for a root-level module (single module or module at project root),
 * or "<rel>/" (forward-slash separated, workspace-relative) otherwise.
 * Used so monorepo modules don't clobber each other's Dockerfile / k8s manifests.
 */
export function moduleStagePrefix(module: ModuleAnalysis, projectPath: string): string {
    if (!module.modulePath) return "";
    const rel = path.isAbsolute(module.modulePath) ? path.relative(projectPath, module.modulePath) : module.modulePath;
    if (!rel || rel === "." || rel.startsWith("..")) return "";
    return `${rel.split(path.sep).join("/")}/`;
}

export async function generateDockerfileStep(
    analysis: AnalysisResult,
    lmClient: LMClient,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    projectPath: string,
    stagedFileManager: StagedFileManager,
    currentStaged: StagedFile[],
    onFileStaged: OnFileStaged,
): Promise<Errorable<{ dockerfile: string }>> {
    const modules = modulesOrProject(analysis, projectPath);
    let dockerfile = "";
    let lastError: string | undefined;
    const staged = [...currentStaged];

    for (const module of modules) {
        if (token.isCancellationRequested) {
            break;
        }

        try {
            const planResult = await sdkGenerateDockerfile(
                {
                    repositoryPath: projectPath,
                    modulePath: path.resolve(projectPath, module.modulePath ?? projectPath),
                    language: module.language,
                    framework: module.framework,
                    detectedDependencies: module.dependencies,
                },
                { signal: tokenToAbortSignal(token) },
            );

            if (!planResult.ok) {
                lastError = formatErrorForLLM(planResult.error, planResult.guidance);
                stream.markdown(`**Dockerfile error:** ${lastError}`);
                continue;
            }

            const response = await lmClient.sendRequestWithTools(
                DOCKERFILE_SYSTEM_PROMPT,
                buildDockerfileUserPrompt(planResult.value),
                {
                    tools: PROJECT_TOOLS,
                    toolHandler: (call) => handleToolCall(call, projectPath),
                },
                token,
            );

            if (failed(response)) {
                lastError = response.error;
                stream.markdown(`**Dockerfile error:** ${response.error}`);
                continue;
            }

            dockerfile = extractContent(response.result, "dockerfile");

            // Stage per-module so monorepo modules don't clobber each other.
            const stagedFilename = `${moduleStagePrefix(module, projectPath)}Dockerfile`;
            const stagedFile = await stagedFileManager.stage(stagedFilename, dockerfile);
            staged.push(stagedFile);
            onFileStaged(stagedFile, staged);
        } catch (error) {
            lastError = String(error);
            stream.markdown(`**Dockerfile error:** ${lastError}`);
        }
    }

    if (!dockerfile) {
        return { succeeded: false, error: lastError ?? "Dockerfile generation failed." };
    }

    return { succeeded: true, result: { dockerfile } };
}

function modulesOrProject(analysis: AnalysisResult, projectPath: string): ModuleAnalysis[] {
    return analysis.modules.length > 0 ? analysis.modules : [{ modulePath: projectPath }];
}
