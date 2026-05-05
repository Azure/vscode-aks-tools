import * as vscode from "vscode";
import { analyzeProject as analyzeProjectStep, tokenToAbortSignal } from "../steps/analyze";
import { checkExistingFiles } from "../../../commands/aksContainerAssist/fileOperations";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { PhaseResult } from "../phaseRunner";
import { AnalysisData } from "../state";

/**
 * Analyzes the project structure, language, framework, and existing artifacts.
 *
 * This phase:
 * 1. Uses the MCP SDK to analyze the repository structure
 * 2. Detects the primary language, framework, and entry point
 * 3. Scans for existing Dockerfile, K8s manifests, and GitHub workflows
 * 4. Streams a summary of findings to the user
 * 5. Validates that language and entry point were detected
 *
 * @param workspaceFolder The workspace folder URI
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with AnalysisData on success
 */
export async function analyzePhase(
    workspaceFolder: vscode.Uri,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<PhaseResult & { analysis?: AnalysisData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        stream.markdown("📊 **Analyzing project structure**\n\n");

        const lmClient = new LMClient();
        const analysisResult = await analyzeProjectStep(workspacePath, lmClient, token);

        if (!analysisResult.succeeded) {
            return {
                ok: false,
                error: `Failed to analyze project: ${analysisResult.error}`,
                retryable: true,
            };
        }

        const { modules, isMonorepo } = analysisResult.result;
        const existingFiles = await checkExistingFiles(workspacePath);
        const primaryModule = modules[0];

        if (!primaryModule?.language) {
            return {
                ok: false,
                error: "Could not detect project language. Please ensure your project has recognizable code files.",
                retryable: false,
            };
        }

        stream.markdown("### Project Analysis Results\n\n");

        let summaryTable = "| Property | Value |\n";
        summaryTable += "|----------|-------|\n";
        summaryTable += `| **Language** | ${primaryModule.language} |\n`;
        if (primaryModule.framework) {
            summaryTable += `| **Framework** | ${primaryModule.framework} |\n`;
        }
        if (primaryModule.entryPoint) {
            summaryTable += `| **Entry Point** | ${primaryModule.entryPoint} |\n`;
        }
        if (primaryModule.port) {
            summaryTable += `| **Port** | ${primaryModule.port} |\n`;
        }
        summaryTable += `| **Modules** | ${modules.length} |\n`;
        summaryTable += `| **Monorepo** | ${isMonorepo ? "Yes" : "No"} |\n`;

        stream.markdown(summaryTable);

        if (existingFiles.hasDockerfile || existingFiles.hasK8sManifests) {
            stream.markdown("\n### Existing Artifacts Detected\n\n");

            if (existingFiles.hasDockerfile) {
                stream.markdown(`- **Dockerfile**: \`${existingFiles.dockerfilePath}\`\n`);
            }

            if (existingFiles.hasK8sManifests && existingFiles.k8sManifestPaths) {
                stream.markdown("- **Kubernetes Manifests**:\n");
                for (const manifestPath of existingFiles.k8sManifestPaths) {
                    stream.markdown(`  - \`${manifestPath}\`\n`);
                }
            }
        }

        stream.markdown("\n### Next Steps\n\n");

        if (isMonorepo && modules.length > 1) {
            stream.markdown(
                `You have a monorepo with ${modules.length} modules. We'll help you containerize and deploy them to AKS.\n\n`,
            );
        }

        if (!existingFiles.hasDockerfile) {
            stream.markdown("- We'll generate a **Dockerfile** optimized for your project\n");
        } else {
            stream.markdown("- Found existing **Dockerfile** - we can use or optimize it\n");
        }

        if (!existingFiles.hasK8sManifests) {
            stream.markdown("- We'll generate **Kubernetes manifests** for deployment\n");
        } else {
            stream.markdown("- Found existing **Kubernetes manifests** - we can use or update them\n");
        }

        stream.markdown("- Configure your Azure container registry and AKS cluster\n");
        stream.markdown("- Build and push your container image\n");
        stream.markdown("- Deploy to your AKS cluster\n");

        const analysis: AnalysisData = {
            language: primaryModule.language,
            framework: primaryModule.framework,
            ports: primaryModule.port ? [primaryModule.port] : [],
            entryPoint: primaryModule.entryPoint,
            isMonorepo,
            modules: modules,
            hasDockerfile: existingFiles.hasDockerfile,
            hasK8sManifests: existingFiles.hasK8sManifests,
            hasGitHubWorkflow: false, // TODO: Implement GitHub workflow detection
        };

        return {
            ok: true,
            analysis,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Analysis phase failed: ${message}`,
            retryable: true,
        };
    }
}
