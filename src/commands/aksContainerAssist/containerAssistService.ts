import * as vscode from "vscode";
import { Errorable, failed } from "../utils/errorable";
import { AnalyzeRepositoryResult, ContainerAssistResult } from "./types";
import * as l10n from "@vscode/l10n";
import { createApp, AppRuntime } from "containerization-assist-mcp";

/**
 * Service for interacting with Container Assist MCP tools
 */
export class ContainerAssistService {
    private appRuntime: AppRuntime | null = null;

    /**
     * Initialize the Container Assist app runtime
     */
    private async initializeRuntime(): Promise<Errorable<AppRuntime>> {
        if (this.appRuntime) {
            return { succeeded: true, result: this.appRuntime };
        }

        try {
            this.appRuntime = await createApp();
            return { succeeded: true, result: this.appRuntime };
        } catch (error) {
            return {
                succeeded: false,
                error: l10n.t("Failed to initialize Container Assist runtime: {0}", String(error)),
            };
        }
    }

    /**
     * Check if Container Assist tools are available
     */
    async isAvailable(): Promise<Errorable<boolean>> {
        try {
            // Check if the containerAssistEnabledPreview setting is enabled
            const config = vscode.workspace.getConfiguration("aks");
            const isEnabled = config.get<boolean>("containerAssistEnabledPreview", false);

            if (!isEnabled) {
                return {
                    succeeded: false,
                    error: l10n.t(
                        "Container Assist is not enabled. Please enable 'aks.containerAssistEnabledPreview' in settings.",
                    ),
                };
            }

            // Check if we can initialize the runtime
            const runtime = await this.initializeRuntime();
            if (failed(runtime)) {
                return {
                    succeeded: false,
                    error: runtime.error,
                };
            }

            return { succeeded: true, result: true };
        } catch (error) {
            return {
                succeeded: false,
                error: l10n.t("Failed to check Container Assist availability: {0}", String(error)),
            };
        }
    }

    /**
     * Analyze the repository to determine language, framework, and other metadata
     */
    async analyzeRepository(folderPath: string): Promise<Errorable<AnalyzeRepositoryResult>> {
        try {
            const runtime = await this.initializeRuntime();
            if (failed(runtime)) {
                return {
                    succeeded: false,
                    error: runtime.error,
                };
            }

            vscode.window.showInformationMessage(
                l10n.t("Container Assist: Analyzing repository at {0}...", folderPath),
            );

            const result = await runtime.result.execute("analyze-repo" as never, {
                repositoryPath: folderPath,
            } as never);

            if (!result.ok) {
                return {
                    succeeded: false,
                    error: l10n.t("Failed to analyze repository: {0}", String(result.error)),
                };
            }

            const analysis = result.value as {
                language?: string;
                framework?: string;
                port?: number;
                buildCommands?: string[];
                startCommands?: string[];
            };

            return {
                succeeded: true,
                result: {
                    language: analysis.language,
                    framework: analysis.framework,
                    port: analysis.port,
                    buildCommand: analysis.buildCommands?.[0],
                    startCommand: analysis.startCommands?.[0],
                },
            };
        } catch (error) {
            return {
                succeeded: false,
                error: l10n.t("Failed to analyze repository: {0}", String(error)),
            };
        }
    }

    /**
     * Generate a Dockerfile for the repository
     */
    async generateDockerfile(
        folderPath: string,
        analysisResult: AnalyzeRepositoryResult,
    ): Promise<Errorable<string>> {
        try {
            const runtime = await this.initializeRuntime();
            if (failed(runtime)) {
                return {
                    succeeded: false,
                    error: runtime.error,
                };
            }

            vscode.window.showInformationMessage(
                l10n.t("Container Assist: Generating Dockerfile for {0}...", folderPath),
            );

            const result = await runtime.result.execute("generate-dockerfile" as never, {
                repositoryPath: folderPath,
                language: analysisResult.language,
                framework: analysisResult.framework,
                port: analysisResult.port,
            } as never);

            if (!result.ok) {
                return {
                    succeeded: false,
                    error: l10n.t("Failed to generate Dockerfile: {0}", String(result.error)),
                };
            }

            // The Dockerfile should have been written to the folder
            const dockerfilePath = `${folderPath}/Dockerfile`;
            return {
                succeeded: true,
                result: dockerfilePath,
            };
        } catch (error) {
            return {
                succeeded: false,
                error: l10n.t("Failed to generate Dockerfile: {0}", String(error)),
            };
        }
    }

    /**
     * Generate Kubernetes manifests for the application
     */
    async generateManifests(
        folderPath: string,
        _dockerfilePath: string,
        appName: string,
    ): Promise<Errorable<string[]>> {
        try {
            const runtime = await this.initializeRuntime();
            if (failed(runtime)) {
                return {
                    succeeded: false,
                    error: runtime.error,
                };
            }

            vscode.window.showInformationMessage(
                l10n.t("Container Assist: Generating Kubernetes manifests for {0}...", appName),
            );

            const result = await runtime.result.execute("generate-k8s-manifests" as never, {
                path: folderPath,
                appName: appName,
                namespace: "default",
                serviceType: "ClusterIP",
                replicas: 1,
            } as never);

            if (!result.ok) {
                return {
                    succeeded: false,
                    error: l10n.t(
                        "Failed to generate Kubernetes manifests: {0}",
                        String(result.error),
                    ),
                };
            }

            // The manifests should have been written to the folder
            const resultValue = result.value as { files?: string[] };
            const manifestPaths: string[] = [];
            if (resultValue.files) {
                for (const file of resultValue.files) {
                    manifestPaths.push(`${folderPath}/${file}`);
                }
            }

            return {
                succeeded: true,
                result: manifestPaths,
            };
        } catch (error) {
            return {
                succeeded: false,
                error: l10n.t("Failed to generate Kubernetes manifests: {0}", String(error)),
            };
        }
    }

    /**
     * Execute the complete deployment generation workflow
     * This orchestrates: Analyze → Generate Dockerfile → Generate K8s Manifests
     */
    async generateDeploymentFiles(folderPath: string, appName: string): Promise<ContainerAssistResult> {
        // Step 1: Analyze the repository
        const analysisResult = await this.analyzeRepository(folderPath);
        if (failed(analysisResult)) {
            return {
                succeeded: false,
                error: analysisResult.error,
            };
        }

        // Step 2: Generate Dockerfile
        const dockerfileResult = await this.generateDockerfile(folderPath, analysisResult.result);
        if (failed(dockerfileResult)) {
            return {
                succeeded: false,
                error: dockerfileResult.error,
            };
        }

        // Step 3: Generate Kubernetes manifests
        const manifestsResult = await this.generateManifests(folderPath, dockerfileResult.result, appName);
        if (failed(manifestsResult)) {
            return {
                succeeded: false,
                error: manifestsResult.error,
            };
        }

        return {
            succeeded: true,
            generatedFiles: [dockerfileResult.result, ...manifestsResult.result],
        };
    }
}
