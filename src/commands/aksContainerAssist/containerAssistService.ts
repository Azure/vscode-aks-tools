import * as vscode from "vscode";
import * as path from "path";
import { Errorable, failed } from "../utils/errorable";
import { AnalyzeRepositoryResult, DeploymentResult, ModuleAnalysisResult } from "./types";
import { logger } from "./logger";
import * as l10n from "@vscode/l10n";
import {
    analyzeRepo,
    generateDockerfile,
    generateK8sManifests,
    formatErrorForLLM,
    formatGenerateDockerfileResult,
    formatGenerateK8sManifestsResult,
    type RepositoryAnalysis,
    type DockerfilePlan,
    type ManifestPlan,
} from "containerization-assist-mcp/sdk";

/** Model family to use for file generation */
const LM_MODEL_FAMILY = "gpt-4o";
/** Model vendor for VS Code Language Model */
const LM_MODEL_VENDOR = "copilot";

/** Regex patterns for cleaning LM response markdown fences */
const MARKDOWN_FENCE_PATTERNS = {
    dockerfile: [/^```dockerfile\n?/i, /^```docker\n?/i, /^```\n?/, /\n?```$/],
    yaml: [/^```ya?ml\n?/gi, /^```\n?/, /\n?```$/],
};

/** Regex to extract content from <content></content> markers */
const CONTENT_MARKER_REGEX = /<content>([\s\S]*?)<\/content>/gi;

/** K8s manifests output folder name */
const K8S_MANIFESTS_FOLDER = "k8s";

/**
 * Service for interacting with Container Assist SDK tools
 */
export class ContainerAssistService {
    private languageModel: vscode.LanguageModelChat | undefined;

    /**
     * Ensure Language Model is available, initializing if needed
     */
    private async ensureLanguageModel(): Promise<Errorable<vscode.LanguageModelChat>> {
        if (this.languageModel) {
            return { succeeded: true, result: this.languageModel };
        }
        return this.isLanguageModelAvailable();
    }

    /**
     * Send a request to the Language Model and collect the streamed response
     */
    private async sendLMRequest(
        systemPrompt: string,
        userPrompt: string,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        if (!this.languageModel) {
            return {
                succeeded: false,
                error: l10n.t("Language Model not available"),
            };
        }

        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(userPrompt),
            ];

            logger.debug("Sending request to Language Model", { model: this.languageModel.name });
            const response = await this.languageModel.sendRequest(messages, {}, token);

            // Collect the streamed response
            let content = "";
            for await (const chunk of response.text) {
                content += chunk;
            }

            logger.debug("Language Model response received", { contentLength: content.length });
            return { succeeded: true, result: content };
        } catch (error) {
            logger.error("Language Model request failed", error);
            return this.handleLMError(error);
        }
    }

    /**
     * Handle Language Model errors consistently
     */
    private handleLMError(error: unknown): Errorable<never> {
        if (error instanceof vscode.LanguageModelError) {
            return {
                succeeded: false,
                error: l10n.t("Language Model error: {0} (code: {1})", error.message, error.code),
            };
        }
        return {
            succeeded: false,
            error: l10n.t("Language Model request failed: {0}", String(error)),
        };
    }

    /**
     * Clean markdown code fences from LM response
     */
    private cleanMarkdownFences(content: string, type: "dockerfile" | "yaml"): string {
        const patterns = MARKDOWN_FENCE_PATTERNS[type];
        let cleaned = content;
        for (const pattern of patterns) {
            cleaned = cleaned.replace(pattern, "");
        }
        return cleaned.trim();
    }

    /**
     * Extract content from <content></content> markers in LM response
     * Falls back to cleaning markdown fences if no markers found
     */
    private extractContent(response: string, type: "dockerfile" | "yaml"): string {
        const matches = [...response.matchAll(CONTENT_MARKER_REGEX)];
        if (matches.length > 0) {
            // Return all matched content blocks joined
            return matches.map(m => m[1].trim()).join("\n---\n");
        }
        // Fallback to markdown fence cleaning
        return this.cleanMarkdownFences(response, type);
    }

    /**
     * Write content to a file
     */
    private async writeFile(filePath: string, content: string): Promise<void> {
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            Buffer.from(content, "utf-8"),
        );
    }

    /**
     * Check if Container Assist tools are available
     */
    async isAvailable(): Promise<Errorable<boolean>> {
        try {
            const config = vscode.workspace.getConfiguration("aks");
            const isEnabled = config.get<boolean>("containerAssistEnabledPreview", false);
            logger.debug("containerAssistEnabledPreview setting", isEnabled);

            if (!isEnabled) {
                const errorMsg = l10n.t(
                    "Container Assist is not enabled. Please enable 'aks.containerAssistEnabledPreview' in settings.",
                );
                return {
                    succeeded: false,
                    error: errorMsg,
                };
            }

            logger.info("Container Assist is available and enabled");
            return { succeeded: true, result: true };
        } catch (error) {
            logger.error("Failed to check availability", error);
            return {
                succeeded: false,
                error: l10n.t("Failed to check Container Assist availability: {0}", String(error)),
            };
        }
    }

    /**
     * Check if the VS Code Language Model is available
     * Must be called before starting Container Assist operations that require LLM
     */
    async isLanguageModelAvailable(): Promise<Errorable<vscode.LanguageModelChat>> {
        try {
            logger.info("Checking Language Model availability...");

            const models = await vscode.lm.selectChatModels({
                vendor: LM_MODEL_VENDOR,
                family: LM_MODEL_FAMILY,
            });

            if (!models || models.length === 0) {
                const errorMsg = l10n.t(
                    "No Language Model available. Please ensure GitHub Copilot is installed and signed in.",
                );
                logger.error("No Language Model found", { vendor: LM_MODEL_VENDOR, family: LM_MODEL_FAMILY });
                return {
                    succeeded: false,
                    error: errorMsg,
                };
            }

            this.languageModel = models[0];
            logger.info(`Language Model available: ${this.languageModel.name} (${this.languageModel.id})`);

            return { succeeded: true, result: this.languageModel };
        } catch (error) {
            logger.error("Failed to check Language Model availability", error);
            if (error instanceof vscode.LanguageModelError) {
                return {
                    succeeded: false,
                    error: l10n.t("Language Model error: {0} (code: {1})", error.message, error.code),
                };
            }
            return {
                succeeded: false,
                error: l10n.t("Failed to access Language Model: {0}", String(error)),
            };
        }
    }

    /**
     * Analyze the repository to determine language, framework, and other metadata
     * Supports monorepos with multiple modules
     */
    async analyzeRepository(folderPath: string, signal?: AbortSignal): Promise<Errorable<AnalyzeRepositoryResult>> {
        logger.info(`Analyzing repository at: ${folderPath}`);
        try {
            const requestParams = { repositoryPath: folderPath };
            logger.debug("analyzeRepo request", requestParams);

            const result = await analyzeRepo(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("analyzeRepo failed", { error: result.error, guidance: result.guidance });
                return {
                    succeeded: false,
                    error: errorMessage,
                };
            }

            const analysis: RepositoryAnalysis = result.value;
            logger.debug("analyzeRepo response", analysis);

            // Map all modules from the analysis result
            const modules: ModuleAnalysisResult[] = (analysis.modules || []).map((module) => ({
                name: module.name,
                modulePath: module.modulePath,
                language: module.language,
                framework: module.frameworks?.[0]?.name,
                port: module.ports?.[0],
                buildCommand: module.buildSystems?.[0]?.type,
                dependencies: module.dependencies,
                entryPoint: module.entryPoint,
            }));

            const isMonorepo = analysis.isMonorepo ?? modules.length > 1;

            logger.info(
                `Repository analysis complete: ${modules.length} module(s), isMonorepo: ${isMonorepo}`,
            );
            modules.forEach((m, i) => {
                logger.debug(`Module ${i + 1}`, m);
            });

            return {
                succeeded: true,
                result: {
                    modules,
                    isMonorepo,
                },
            };
        } catch (error) {
            logger.error("analyzeRepo exception", error);
            return {
                succeeded: false,
                error: l10n.t("Failed to analyze repository: {0}", String(error)),
            };
        }
    }

    /**
     * Generate a Dockerfile for a specific module using the Language Model
     */
    async generateDockerfile(
        modulePath: string,
        moduleInfo: ModuleAnalysisResult,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        logger.info(`Generating Dockerfile for module: ${moduleInfo.name} at ${modulePath}`);

        const lmResult = await this.ensureLanguageModel();
        if (failed(lmResult)) {
            return lmResult;
        }

        try {
            const requestParams = {
                repositoryPath: modulePath,
                modulePath: modulePath,
                language: moduleInfo.language,
                framework: moduleInfo.framework,
                detectedDependencies: moduleInfo.dependencies,
            };
            logger.debug("generateDockerfile request", requestParams);

            const result = await generateDockerfile(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("generateDockerfile failed", { error: result.error, guidance: result.guidance });
                return { succeeded: false, error: errorMessage };
            }

            const plan: DockerfilePlan = result.value;
            logger.debug("generateDockerfile response", plan);

            // Generate Dockerfile content using LM
            const dockerfileContent = await this.generateDockerfileWithLM(plan, token);
            if (failed(dockerfileContent)) {
                return dockerfileContent;
            }

            // Write to disk
            const dockerfilePath = path.join(modulePath, "Dockerfile");
            await this.writeFile(dockerfilePath, dockerfileContent.result);

            logger.info(`Dockerfile generated: ${dockerfilePath}`);
            return { succeeded: true, result: dockerfilePath };
        } catch (error) {
            logger.error("generateDockerfile exception", error);
            return {
                succeeded: false,
                error: l10n.t("Failed to generate Dockerfile: {0}", String(error)),
            };
        }
    }

    /**
     * Use the Language Model to generate Dockerfile content from the plan
     */
    private async generateDockerfileWithLM(
        plan: DockerfilePlan,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        const systemPrompt = `You are an expert at creating optimized, production-ready Dockerfiles.
Based on the analysis and recommendations provided, generate a complete Dockerfile.
Follow all security best practices, use multi-stage builds when recommended, and include appropriate comments.

IMPORTANT: Your response must contain ONLY the Dockerfile content wrapped in <content></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.

Example response format:
<content>
FROM node:20-alpine
# ... rest of Dockerfile
</content>`;

        const repoInfo = plan.repositoryInfo;
        const formattedPlan = formatGenerateDockerfileResult(plan);
        
        let userPrompt = `Generate a Dockerfile based on the following analysis and recommendations:

${formattedPlan}

Repository Info:
- Language: ${repoInfo?.language || "unknown"}
- Framework: ${repoInfo?.frameworks?.map((f) => f.name).join(", ") || "none"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}
- Ports: ${repoInfo?.ports?.join(", ") || "none detected"}`;

        if (plan.existingDockerfile) {
            const guidance = plan.existingDockerfile.guidance;
            userPrompt += `

Existing Dockerfile to enhance:
${plan.existingDockerfile.content}

Enhancement guidance:
- Preserve: ${guidance.preserve.join(", ")}
- Improve: ${guidance.improve.join(", ")}
- Add missing: ${guidance.addMissing.join(", ")}`;
        }

        userPrompt += "\n\nGenerate the complete Dockerfile now. Remember to wrap the output in <content></content> markers:";

        const response = await this.sendLMRequest(systemPrompt, userPrompt, token);
        if (failed(response)) {
            return response;
        }

        return {
            succeeded: true,
            result: this.extractContent(response.result, "dockerfile"),
        };
    }

    /**
     * Generate Kubernetes manifests for a specific module using the Language Model
     */
    async generateManifests(
        modulePath: string,
        appName: string,
        moduleInfo: ModuleAnalysisResult,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string[]>> {
        logger.info(`Generating Kubernetes manifests for: ${appName}`);

        const lmResult = await this.ensureLanguageModel();
        if (failed(lmResult)) {
            return lmResult;
        }

        try {
            const config = vscode.workspace.getConfiguration("aks.containerAssist");
            const namespace = config.get<string>("defaultNamespace", "default");

            const requestParams = {
                manifestType: "kubernetes" as const,
                modulePath,
                name: appName,
                namespace,
                language: moduleInfo.language as "java" | "dotnet" | "javascript" | "typescript" | "python" | "rust" | "go" | "other" | undefined,
                ports: moduleInfo.port ? [moduleInfo.port] : undefined,
                detectedDependencies: moduleInfo.dependencies,
                entryPoint: moduleInfo.entryPoint,
            };
            logger.debug("generateK8sManifests request", requestParams);

            const result = await generateK8sManifests(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("generateK8sManifests failed", { error: result.error, guidance: result.guidance });
                return { succeeded: false, error: errorMessage };
            }

            const plan: ManifestPlan = result.value;
            logger.debug("generateK8sManifests response", plan);

            // Generate manifests content using LM
            const manifestsContent = await this.generateManifestsWithLM(plan, appName, namespace, token);
            if (failed(manifestsContent)) {
                return manifestsContent;
            }

            // Create k8s folder and write each manifest file
            const k8sFolder = path.join(modulePath, K8S_MANIFESTS_FOLDER);
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(k8sFolder));

            const manifestPaths: string[] = [];
            for (const manifest of manifestsContent.result) {
                const manifestPath = path.join(k8sFolder, manifest.filename);
                await this.writeFile(manifestPath, manifest.content);
                manifestPaths.push(manifestPath);
            }

            logger.info(`Generated ${manifestPaths.length} manifest files`);
            logger.debug("Generated manifest paths", manifestPaths);

            return { succeeded: true, result: manifestPaths };
        } catch (error) {
            logger.error("generateK8sManifests exception", error);
            return {
                succeeded: false,
                error: l10n.t("Failed to generate Kubernetes manifests: {0}", String(error)),
            };
        }
    }

    /**
     * Use the Language Model to generate K8s manifest content from the plan
     */
    private async generateManifestsWithLM(
        plan: ManifestPlan,
        appName: string,
        namespace: string,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<Array<{ filename: string; content: string }>>> {
        const systemPrompt = `You are an expert at creating production-ready Kubernetes manifests.
Based on the analysis and recommendations provided, generate complete Kubernetes YAML manifests.
Follow all security best practices, include resource limits, health checks, and appropriate labels.

IMPORTANT: Generate EACH manifest file separately with its own <content filename="FILENAME"></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.
Each file should be a separate, complete YAML document.

Example response format:
<content filename="deployment.yaml">
apiVersion: apps/v1
kind: Deployment
# ... rest of deployment
</content>
<content filename="service.yaml">
apiVersion: v1
kind: Service
# ... rest of service
</content>`;

        const repoInfo = plan.repositoryInfo;
        const formattedPlan = formatGenerateK8sManifestsResult(plan);

        const userPrompt = `Generate Kubernetes manifests based on the following analysis and recommendations:

${formattedPlan}

Application Details:
- Name: ${appName}
- Namespace: ${namespace}
- Language: ${repoInfo?.language || "unknown"}
- Framework: ${repoInfo?.frameworks?.map((f) => f.name).join(", ") || "none"}
- Ports: ${repoInfo?.ports?.join(", ") || "8080"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}

Generate the following Kubernetes manifest files (each in separate <content filename="..."></content> markers):
1. deployment.yaml - with proper resource limits, health checks, and security context
2. service.yaml - ClusterIP service exposing the application ports
3. ingress.yaml - Ingress resource for external access (use nginx ingress class)

Generate the manifests now:`;

        const response = await this.sendLMRequest(systemPrompt, userPrompt, token);
        if (failed(response)) {
            return response;
        }

        const manifests = this.parseManifestsFromLMResponse(response.result, appName);

        return { succeeded: true, result: manifests };
    }

    /**
     * Parse the LM response containing manifest files with content markers
     */
    private parseManifestsFromLMResponse(
        content: string,
        appName: string,
    ): Array<{ filename: string; content: string }> {
        const manifests: Array<{ filename: string; content: string }> = [];
        
        // Try to extract from <content filename="..."></content> markers first
        const contentWithFilenameRegex = /<content\s+filename=["']([^"']+)["']>([\s\S]*?)<\/content>/gi;
        let match;
        
        while ((match = contentWithFilenameRegex.exec(content)) !== null) {
            const filename = match[1];
            const fileContent = match[2].trim();
            if (filename && fileContent) {
                manifests.push({ filename, content: fileContent });
            }
        }

        // If we found content markers with filenames, return them
        if (manifests.length > 0) {
            return manifests;
        }

        // Fallback: try simple <content></content> markers
        const simpleContentRegex = /<content>([\s\S]*?)<\/content>/gi;
        const simpleMatches = [...content.matchAll(simpleContentRegex)];
        
        if (simpleMatches.length > 0) {
            // Parse the combined content as before
            const combinedContent = simpleMatches.map(m => m[1].trim()).join("\n---\n");
            return this.parseYamlDocuments(combinedContent, appName);
        }

        // Final fallback: clean markdown and parse YAML documents
        const cleanedContent = this.cleanMarkdownFences(content, "yaml");
        return this.parseYamlDocuments(cleanedContent, appName);
    }

    /**
     * Parse YAML documents separated by --- into separate manifest files
     */
    private parseYamlDocuments(
        content: string,
        appName: string,
    ): Array<{ filename: string; content: string }> {
        const manifests: Array<{ filename: string; content: string }> = [];
        
        // Split by YAML document separator
        const documents = content.split(/^---$/m).filter((doc) => doc.trim());

        for (const doc of documents) {
            const trimmedDoc = doc.trim();
            if (!trimmedDoc) continue;

            // Try to extract filename from comment
            const filenameMatch = trimmedDoc.match(/^#\s*([\w-]+\.ya?ml)/i);
            let filename: string;

            if (filenameMatch) {
                filename = filenameMatch[1];
            } else {
                // Try to determine filename from kind
                const kindMatch = trimmedDoc.match(/kind:\s*(\w+)/i);
                if (kindMatch) {
                    const kind = kindMatch[1].toLowerCase();
                    filename = `${kind}.yaml`;
                } else {
                    // Fallback to generic name
                    filename = `${appName}-manifest-${manifests.length + 1}.yaml`;
                }
            }

            // Remove the filename comment if present
            const contentWithoutComment = trimmedDoc.replace(/^#\s*[\w-]+\.ya?ml\s*\n/i, "").trim();

            manifests.push({
                filename,
                content: contentWithoutComment,
            });
        }

        // Ensure we have at least deployment and service
        const hasDeployment = manifests.some((m) => m.filename.toLowerCase().includes("deployment"));
        const hasService = manifests.some((m) => m.filename.toLowerCase().includes("service"));

        if (!hasDeployment && !hasService && manifests.length === 1) {
            // If we only got one document without clear identification, assume it's a deployment
            manifests[0].filename = "deployment.yaml";
        }

        return manifests;
    }

    /**
     * Execute the complete deployment generation workflow
     * This orchestrates: Check LM → Analyze → Generate Dockerfiles → Generate K8s Manifests
     * Supports monorepos by generating files for each detected module
     */
    async generateDeploymentFiles(
        folderPath: string,
        appName: string,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<DeploymentResult>> {
        logger.info(`Starting deployment workflow for: ${appName}`);
        logger.debug("Deployment workflow params", { folderPath, appName });

        // Step 0: Check Language Model availability
        logger.info("Step 0: Checking Language Model availability...");
        const lmResult = await this.isLanguageModelAvailable();
        if (failed(lmResult)) {
            logger.error("Language Model not available", lmResult.error);
            return lmResult;
        }

        // Step 1: Analyze repository
        logger.info("Step 1: Analyzing repository...");
        const analysisResult = await this.analyzeRepository(folderPath, signal);
        if (failed(analysisResult)) {
            logger.error("Workflow failed at analysis step", analysisResult.error);
            return analysisResult;
        }

        const { modules, isMonorepo } = analysisResult.result;

        if (modules.length === 0) {
            return {
                succeeded: false,
                error: l10n.t("No modules detected in repository. Unable to generate deployment files."),
            };
        }

        logger.info(`Detected ${modules.length} module(s), isMonorepo: ${isMonorepo}`);

        const allGeneratedFiles: string[] = [];

        // Step 2: Generate Dockerfiles for each module
        logger.info(`Step 2: Generating Dockerfiles for ${modules.length} module(s)...`);
        for (const module of modules) {
            logger.info(`Generating Dockerfile for module: ${module.name}`);
            const dockerfileResult = await this.generateDockerfile(
                module.modulePath,
                module,
                signal,
                token,
            );
            if (failed(dockerfileResult)) {
                logger.error(`Workflow failed at Dockerfile step for module: ${module.name}`, dockerfileResult.error);
                return dockerfileResult;
            }
            allGeneratedFiles.push(dockerfileResult.result);
        }

        // Step 3: Generate Kubernetes manifests for each module
        logger.info(`Step 3: Generating Kubernetes manifests for ${modules.length} module(s)...`);
        for (const module of modules) {
            const manifestAppName = isMonorepo ? `${appName}-${module.name}` : appName;
            logger.info(`Generating manifests for module: ${module.name} as ${manifestAppName}`);
            const manifestsResult = await this.generateManifests(
                module.modulePath,
                manifestAppName,
                module,
                signal,
                token,
            );
            if (failed(manifestsResult)) {
                logger.error(`Workflow failed at manifests step for module: ${module.name}`, manifestsResult.error);
                return manifestsResult;
            }
            allGeneratedFiles.push(...manifestsResult.result);
        }

        logger.info(`Deployment workflow completed: ${allGeneratedFiles.length} files generated`);
        logger.debug("Generated files", allGeneratedFiles);

        return {
            succeeded: true,
            result: {
                generatedFiles: allGeneratedFiles,
            },
        };
    }
}
