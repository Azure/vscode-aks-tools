import * as vscode from "vscode";
import { generateK8sManifests as sdkGenerateK8sManifests, formatErrorForLLM } from "containerization-assist-mcp/sdk";
import { K8S_MANIFEST_SYSTEM_PROMPT, buildK8sManifestUserPrompt } from "../../../commands/aksContainerAssist/prompts";
import { PROJECT_TOOLS, handleToolCall } from "../../../commands/aksContainerAssist/tools";
import {
    parseManifestsFromLMResponse,
    fixManifestImageReferences,
} from "../../../commands/aksContainerAssist/contentParser";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { Errorable, failed } from "../../../commands/utils/errorable";
import { AnalysisResult, ModuleAnalysis, tokenToAbortSignal } from "./analyze";
import { StagedFileManager } from "../stagedFileManager";
import { StagedFile } from "../state";
import { OnFileStaged } from "./dockerfile";

export async function generateManifestsStep(
    analysis: AnalysisResult,
    _dockerfileResult: Errorable<{ dockerfile: string }>,
    lmClient: LMClient,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    projectPath: string,
    stagedFileManager: StagedFileManager,
    currentStaged: StagedFile[],
    onFileStaged: OnFileStaged,
    options?: { acrLoginServer?: string; clusterName?: string },
): Promise<Errorable<{ files: Record<string, string> }>> {
    const modules = modulesOrProject(analysis, projectPath);
    const files: Record<string, string> = {};
    let lastError: string | undefined;
    const staged = [...currentStaged];

    for (const module of modules) {
        if (token.isCancellationRequested) {
            break;
        }

        try {
            const planResult = await sdkGenerateK8sManifests(
                {
                    manifestType: "kubernetes",
                    repositoryPath: projectPath,
                    modulePath: module.modulePath ?? projectPath,
                    language: module.language,
                    framework: module.framework,
                },
                { signal: tokenToAbortSignal(token) },
            );

            if (!planResult.ok) {
                lastError = formatErrorForLLM(planResult.error, planResult.guidance);
                stream.markdown(`**Kubernetes manifests error:** ${lastError}`);
                continue;
            }

            const appName = module.name ?? "app";
            const response = await lmClient.sendRequestWithTools(
                K8S_MANIFEST_SYSTEM_PROMPT,
                buildK8sManifestUserPrompt(
                    planResult.value,
                    appName,
                    "default",
                    options?.acrLoginServer ?? "<your-registry>",
                ),
                {
                    tools: PROJECT_TOOLS,
                    toolHandler: (call) => handleToolCall(call, projectPath),
                },
                token,
            );

            if (failed(response)) {
                lastError = response.error;
                stream.markdown(`**Kubernetes manifests error:** ${response.error}`);
                continue;
            }

            const parsed = parseManifestsFromLMResponse(response.result, appName);
            const manifests = options?.acrLoginServer
                ? fixManifestImageReferences(parsed, options.acrLoginServer)
                : parsed;

            for (const manifest of manifests) {
                const stageFilename = `k8s/${manifest.filename}`;
                files[manifest.filename] = manifest.content;

                // Stage the file and notify
                const stagedFile = await stagedFileManager.stage(stageFilename, manifest.content);
                staged.push(stagedFile);
                onFileStaged(stagedFile, staged);
            }
        } catch (error) {
            lastError = String(error);
            stream.markdown(`**Kubernetes manifests error:** ${lastError}`);
        }
    }

    if (Object.keys(files).length === 0) {
        return { succeeded: false, error: lastError ?? "Kubernetes manifest generation failed." };
    }

    return { succeeded: true, result: { files } };
}

function modulesOrProject(analysis: AnalysisResult, projectPath: string): ModuleAnalysis[] {
    return analysis.modules.length > 0 ? analysis.modules : [{ modulePath: projectPath }];
}
