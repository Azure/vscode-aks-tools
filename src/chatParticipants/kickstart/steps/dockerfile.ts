import * as vscode from "vscode";
import { generateDockerfile as sdkGenerateDockerfile, formatErrorForLLM } from "containerization-assist-mcp/sdk";
import { DOCKERFILE_SYSTEM_PROMPT, buildDockerfileUserPrompt } from "../../../commands/aksContainerAssist/prompts";
import { PROJECT_TOOLS, handleToolCall } from "../../../commands/aksContainerAssist/tools";
import { extractContent } from "../../../commands/aksContainerAssist/contentParser";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { Errorable, failed } from "../../../commands/utils/errorable";
import { AnalysisResult, ModuleAnalysis, tokenToAbortSignal } from "./analyze";

export async function generateDockerfileStep(
    analysis: AnalysisResult,
    lmClient: LMClient,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    projectPath: string,
): Promise<Errorable<{ dockerfile: string; dockerignore?: string }>> {
    const modules = modulesOrProject(analysis, projectPath);
    let dockerfile = "";
    let lastError: string | undefined;

    for (const module of modules) {
        if (token.isCancellationRequested) {
            break;
        }

        try {
            const planResult = await sdkGenerateDockerfile(
                {
                    repositoryPath: projectPath,
                    modulePath: module.modulePath ?? projectPath,
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
            stream.markdown(`**Dockerfile**\n\`\`\`dockerfile\n${dockerfile}\n\`\`\``);
            stream.button({
                command: "aks.kickstart.saveFile",
                title: "Save Dockerfile",
                arguments: [{ filename: "Dockerfile", content: dockerfile, projectPath }],
            });
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
