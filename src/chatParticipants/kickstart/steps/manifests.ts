import * as path from "path";
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

export interface ExistingManifestInput {
    filename: string;
    content: string;
}

export async function generateManifestsStep(
    analysis: AnalysisResult,
    _dockerfileResult: Errorable<{ dockerfile: string }>,
    lmClient: LMClient,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    projectPath: string,
    options?: {
        acrLoginServer?: string;
        clusterName?: string;
        namespace?: string;
        existingManifestsByModule?: Map<string, ExistingManifestInput[]>;
    },
): Promise<Errorable<{ files: Record<string, string> }>> {
    const modules = modulesOrProject(analysis, projectPath);
    const files: Record<string, string> = {};
    let lastError: string | undefined;

    for (const module of modules) {
        if (token.isCancellationRequested) {
            break;
        }

        try {
            const planResult = await sdkGenerateK8sManifests(
                {
                    manifestType: "kubernetes",
                    repositoryPath: projectPath,
                    modulePath: path.resolve(projectPath, module.modulePath ?? projectPath),
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
            const existingManifestsForModule = options?.existingManifestsByModule?.get(module.modulePath ?? "");
            const response = await lmClient.sendRequestWithTools(
                K8S_MANIFEST_SYSTEM_PROMPT,
                buildK8sManifestUserPrompt(
                    planResult.value,
                    appName,
                    options?.namespace ?? "default",
                    options?.acrLoginServer ?? "<your-registry>",
                    existingManifestsForModule,
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
                files[manifest.filename] = manifest.content;
                stream.markdown(`**${manifest.filename}**\n\`\`\`yaml\n${manifest.content}\n\`\`\``);
                stream.button({
                    command: "aks.kickstart.saveFile",
                    title: `Save ${manifest.filename}`,
                    arguments: [{ filename: `k8s/${manifest.filename}`, content: manifest.content, projectPath }],
                });
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
