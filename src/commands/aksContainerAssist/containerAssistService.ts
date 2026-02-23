import * as vscode from "vscode";
import * as path from "path";
import { Errorable, failed } from "../utils/errorable";
import { AnalyzeRepositoryResult, DeploymentResult, ExistingFilesCheckResult, ModuleAnalysisResult } from "./types";
import { logger } from "./logger";
import * as l10n from "@vscode/l10n";
import {
    analyzeRepo,
    generateDockerfile as sdkGenerateDockerfile,
    generateK8sManifests as sdkGenerateK8sManifests,
    formatErrorForLLM,
    type RepositoryAnalysis,
    type DockerfilePlan,
    type ManifestPlan,
} from "containerization-assist-mcp/sdk";

import { LMClient } from "./lmClient";
import { extractContent, parseManifestsFromLMResponse } from "./contentParser";
import { checkExistingFiles, writeFile, ensureDirectory, getK8sManifestFolder } from "./fileOperations";
import {
    DOCKERFILE_SYSTEM_PROMPT,
    K8S_MANIFEST_SYSTEM_PROMPT,
    buildDockerfileUserPrompt,
    buildK8sManifestUserPrompt,
} from "./prompts";
import { PROJECT_TOOLS, handleToolCall } from "./tools";

export class ContainerAssistService {
    private lmClient: LMClient;

    constructor() {
        this.lmClient = new LMClient();
    }

    private handleSdkError(operation: string, error: unknown): Errorable<never> {
        logger.error(`${operation} exception`, error);
        return {
            succeeded: false,
            error: l10n.t("Failed to {0}: {1}", operation, String(error)),
        };
    }

    async isAvailable(): Promise<Errorable<boolean>> {
        try {
            const config = vscode.workspace.getConfiguration("aks");
            const isEnabled = config.get<boolean>("containerAssistEnabledPreview", false);
            logger.debug("containerAssistEnabledPreview setting", isEnabled);

            if (!isEnabled) {
                const errorMsg = l10n.t(
                    "Container Assist is not enabled. Please enable 'aks.containerAssistEnabledPreview' in settings.",
                );
                return { succeeded: false, error: errorMsg };
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

    async checkExistingFiles(folderPath: string): Promise<ExistingFilesCheckResult> {
        return checkExistingFiles(folderPath);
    }

    async selectLanguageModel(showPicker: boolean = false): Promise<Errorable<vscode.LanguageModelChat>> {
        return this.lmClient.selectModel(showPicker);
    }

    async analyzeRepository(folderPath: string, signal?: AbortSignal): Promise<Errorable<AnalyzeRepositoryResult>> {
        logger.info(`Analyzing repository at: ${folderPath}`);
        try {
            const requestParams = { repositoryPath: folderPath };
            logger.debug("analyzeRepo request", requestParams);
            logger.toolRequest("analyzeRepo", requestParams);

            const result = await analyzeRepo(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("analyzeRepo failed", { error: result.error, guidance: result.guidance });
                return { succeeded: false, error: errorMessage };
            }

            const analysis: RepositoryAnalysis = result.value;
            logger.debug("analyzeRepo response", analysis);
            logger.toolResponse("analyzeRepo", analysis);

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

            logger.info(`Repository analysis complete: ${modules.length} module(s), isMonorepo: ${isMonorepo}`);
            if (modules.length > 0) {
                logger.debug(`Analyzed ${modules.length} modules`, modules);
            }

            return {
                succeeded: true,
                result: { modules, isMonorepo },
            };
        } catch (error) {
            return this.handleSdkError("analyze repository", error);
        }
    }

    async generateDockerfile(
        modulePath: string,
        moduleInfo: ModuleAnalysisResult,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        logger.info(`Generating Dockerfile for module: ${moduleInfo.name} at ${modulePath}`);

        const lmResult = await this.lmClient.ensureModel();
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
            logger.toolRequest("generateDockerfile", requestParams);

            const result = await sdkGenerateDockerfile(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("generateDockerfile failed", { error: result.error, guidance: result.guidance });
                return { succeeded: false, error: errorMessage };
            }

            const plan: DockerfilePlan = result.value;
            logger.debug("generateDockerfile response", plan);
            logger.toolResponse("generateDockerfile", plan);

            const dockerfileContent = await this.generateDockerfileWithLM(plan, modulePath, token);
            if (failed(dockerfileContent)) {
                return dockerfileContent;
            }

            const dockerfilePath = path.join(modulePath, "Dockerfile");
            await writeFile(dockerfilePath, dockerfileContent.result);

            logger.info(`Dockerfile generated: ${dockerfilePath}`);
            return { succeeded: true, result: dockerfilePath };
        } catch (error) {
            return this.handleSdkError("generate Dockerfile", error);
        }
    }

    private async generateDockerfileWithLM(
        plan: DockerfilePlan,
        workspaceRoot: string,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        const userPrompt = buildDockerfileUserPrompt(plan);
        const response = await this.lmClient.sendRequestWithTools(
            DOCKERFILE_SYSTEM_PROMPT,
            userPrompt,
            {
                tools: PROJECT_TOOLS,
                toolHandler: (call) => handleToolCall(call, workspaceRoot),
                maxToolRounds: 5,
            },
            token,
        );

        if (failed(response)) {
            return response;
        }

        return {
            succeeded: true,
            result: extractContent(response.result, "dockerfile"),
        };
    }

    async generateManifests(
        modulePath: string,
        appName: string,
        moduleInfo: ModuleAnalysisResult,
        namespace: string,
        imageRepository?: string,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string[]>> {
        logger.info(`Generating Kubernetes manifests for: ${appName}`);

        const lmResult = await this.lmClient.ensureModel();
        if (failed(lmResult)) {
            return lmResult;
        }

        try {
            const targetNamespace = namespace || "default";

            const requestParams = {
                manifestType: "kubernetes" as const,
                modulePath,
                name: appName,
                namespace: targetNamespace,
                language: moduleInfo.language as
                    | "java"
                    | "dotnet"
                    | "javascript"
                    | "typescript"
                    | "python"
                    | "rust"
                    | "go"
                    | "other"
                    | undefined,
                ports: moduleInfo.port ? [moduleInfo.port] : undefined,
                detectedDependencies: moduleInfo.dependencies,
                entryPoint: moduleInfo.entryPoint,
            };
            logger.debug("generateK8sManifests request", requestParams);
            logger.toolRequest("generateK8sManifests", requestParams);

            const result = await sdkGenerateK8sManifests(requestParams, { signal });

            if (!result.ok) {
                const errorMessage = formatErrorForLLM(result.error, result.guidance);
                logger.error("generateK8sManifests failed", { error: result.error, guidance: result.guidance });
                return { succeeded: false, error: errorMessage };
            }

            const plan: ManifestPlan = result.value;
            logger.debug("generateK8sManifests response", plan);
            logger.toolResponse("generateK8sManifests", plan);

            const manifestsContent = await this.generateManifestsWithLM(
                plan,
                appName,
                targetNamespace,
                imageRepository,
                modulePath,
                token,
            );
            if (failed(manifestsContent)) {
                return manifestsContent;
            }

            const k8sFolder = path.join(modulePath, getK8sManifestFolder());
            await ensureDirectory(k8sFolder);

            const manifestPaths: string[] = [];
            for (const manifest of manifestsContent.result) {
                const manifestPath = path.join(k8sFolder, manifest.filename);
                await writeFile(manifestPath, manifest.content);
                manifestPaths.push(manifestPath);
            }

            logger.info(`Generated ${manifestPaths.length} manifest files`);
            logger.debug("Generated manifest paths", manifestPaths);

            return { succeeded: true, result: manifestPaths };
        } catch (error) {
            return this.handleSdkError("generate Kubernetes manifests", error);
        }
    }

    private async generateManifestsWithLM(
        plan: ManifestPlan,
        appName: string,
        namespace: string,
        imageRepository: string | undefined,
        workspaceRoot: string,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<Array<{ filename: string; content: string }>>> {
        const userPrompt = buildK8sManifestUserPrompt(plan, appName, namespace, imageRepository);
        const response = await this.lmClient.sendRequestWithTools(
            K8S_MANIFEST_SYSTEM_PROMPT,
            userPrompt,
            {
                tools: PROJECT_TOOLS,
                toolHandler: (call) => handleToolCall(call, workspaceRoot),
                maxToolRounds: 5,
            },
            token,
        );

        if (failed(response)) {
            return response;
        }

        const manifests = parseManifestsFromLMResponse(response.result, appName);
        return { succeeded: true, result: manifests };
    }

    async generateDeploymentFiles(
        folderPath: string,
        appName: string,
        acrLoginServer?: string,
        signal?: AbortSignal,
        token?: vscode.CancellationToken,
        showModelPicker: boolean = false,
        onProgress?: (message: string) => void,
    ): Promise<Errorable<DeploymentResult>> {
        const reportProgress = (message: string) => onProgress?.(message);

        logger.info(`Starting deployment workflow for: ${appName}`);
        logger.debug("Deployment workflow params", { folderPath, appName, acrLoginServer });

        logger.info("Step 0: Checking for existing deployment files...");
        const existingFiles = await this.checkExistingFiles(folderPath);

        const skipDockerfile = existingFiles.hasDockerfile;
        const skipK8sManifests = existingFiles.hasK8sManifests;

        if (skipDockerfile && skipK8sManifests) {
            const message = l10n.t(
                "Deployment files already exist (Dockerfile and {0}/ manifests). No new files generated.",
                getK8sManifestFolder(),
            );
            logger.info(message);
            vscode.window.showInformationMessage(message);
            return {
                succeeded: true,
                result: { generatedFiles: [] },
            };
        }

        if (skipDockerfile || skipK8sManifests) {
            const existingList = [
                skipDockerfile && "Dockerfile",
                skipK8sManifests && `${getK8sManifestFolder()}/ manifests`,
            ].filter(Boolean);
            logger.info(`Existing files found (will be preserved): ${existingList.join(", ")}`);
            vscode.window.showInformationMessage(l10n.t("Existing {0} will be preserved.", existingList.join(", ")));
        }

        logger.info("Step 1: Selecting Language Model...");
        const lmResult = await this.selectLanguageModel(showModelPicker);
        if (failed(lmResult)) {
            logger.error("Language Model not available", lmResult.error);
            return lmResult;
        }

        logger.info("Step 2: Analyzing repository...");
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

        if (!skipDockerfile) {
            logger.info(`Step 3: Generating Dockerfiles for ${modules.length} module(s)...`);
            for (const module of modules) {
                logger.info(`Generating Dockerfile for module: ${module.name}`);
                reportProgress(l10n.t("Generating Dockerfile for {0}...", module.name));
                const dockerfileResult = await this.generateDockerfile(module.modulePath, module, signal, token);
                if (failed(dockerfileResult)) {
                    logger.error(
                        `Workflow failed at Dockerfile step for module: ${module.name}`,
                        dockerfileResult.error,
                    );
                    return dockerfileResult;
                }
                allGeneratedFiles.push(dockerfileResult.result);
            }
        } else {
            logger.info("Step 3: Skipping Dockerfile generation (existing files preserved)");
        }

        if (!skipK8sManifests) {
            logger.info(`Step 4: Generating Kubernetes manifests for ${modules.length} module(s)...`);
            for (const module of modules) {
                const manifestAppName = isMonorepo ? `${appName}-${module.name}` : appName;
                logger.info(`Generating manifests for module: ${module.name} as ${manifestAppName}`);
                reportProgress(l10n.t("Generating Kubernetes manifests for {0}...", module.name));
                const manifestNamespace = "default";
                const imageRepository = acrLoginServer ? `${acrLoginServer}/${manifestAppName}` : undefined;
                const manifestsResult = await this.generateManifests(
                    module.modulePath,
                    manifestAppName,
                    module,
                    manifestNamespace,
                    imageRepository,
                    signal,
                    token,
                );
                if (failed(manifestsResult)) {
                    logger.error(`Workflow failed at manifests step for module: ${module.name}`, manifestsResult.error);
                    return manifestsResult;
                }
                allGeneratedFiles.push(...manifestsResult.result);
            }
        } else {
            logger.info("Step 4: Skipping K8s manifest generation (existing files preserved)");
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
