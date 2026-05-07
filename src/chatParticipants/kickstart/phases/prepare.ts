import * as vscode from "vscode";
import { generateDockerfileStep } from "../steps/dockerfile";
import { generateManifestsStep } from "../steps/manifests";
import { AnalysisResult } from "../steps/analyze";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { failed } from "../../../commands/utils/errorable";
import { PhaseResult } from "../phaseRunner";
import { AnalysisData, ConfigData, ArtifactsData, Manifest } from "../state";

/**
 * Generates Dockerfile and Kubernetes manifests with AKS Automatic awareness.
 *
 * This phase:
 * 1. Generates a Dockerfile optimized for the detected project
 * 2. Generates Kubernetes manifests (Deployment, Service, and optionally Ingress/HPA)
 * 3. Applies AKS Automatic-specific adaptations:
 *    - Omits resource requests/limits for Automatic clusters
 *    - Uses web app routing ingress class for Automatic
 *    - Skips HPA generation for Automatic
 * 4. Streams all artifacts to the user with save buttons
 * 5. Returns ArtifactsData with all generated files (not saved to disk yet)
 *
 * @param workspaceFolder The workspace folder URI
 * @param analysis Project analysis data from ANALYZE phase
 * @param config Cluster and registry configuration from CONFIGURE phase
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with ArtifactsData on success
 */
export async function preparePhase(
    workspaceFolder: vscode.Uri,
    analysis: AnalysisData,
    config: ConfigData,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<PhaseResult & { artifacts?: ArtifactsData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        stream.markdown("🐳 **Preparing artifacts**\n\n");

        // Show which cluster SKU is being used
        const skuLabel = config.clusterSku === "Automatic" ? "AKS Automatic" : "AKS Standard";
        stream.markdown(`Generating artifacts for **${skuLabel}** cluster...\n\n`);

        if (config.clusterSku === "Automatic") {
            stream.markdown(
                "ℹ️ **AKS Automatic adaptations:**\n" +
                    "- Resource limits will be omitted (Automatic manages these)\n" +
                    "- Web app routing ingress class will be used\n" +
                    "- Horizontal Pod Autoscaler will be skipped\n\n",
            );
        }

        const lmClient = new LMClient();
        const modelResult = await lmClient.ensureModel();
        if (failed(modelResult)) {
            return {
                ok: false,
                error: "GitHub Copilot language model is required for artifact generation. Please ensure Copilot is installed and signed in.",
                retryable: true,
            };
        }

        // Convert AnalysisData to AnalysisResult format for the step functions
        const analysisResult: AnalysisResult = {
            modules: analysis.modules,
            isMonorepo: analysis.isMonorepo,
        };

        // Step 1: Generate Dockerfile
        stream.markdown("### Generating Dockerfile\n\n");
        stream.progress("Generating Dockerfile...");

        const dockerfileResult = await generateDockerfileStep(analysisResult, lmClient, stream, token, workspacePath);

        if (!dockerfileResult.succeeded) {
            return {
                ok: false,
                error: `Dockerfile generation failed: ${dockerfileResult.error}`,
                retryable: true,
            };
        }

        const dockerfile = dockerfileResult.result.dockerfile;

        // Step 2: Generate Kubernetes manifests
        stream.markdown("### Generating Kubernetes Manifests\n\n");
        stream.progress("Generating Kubernetes manifests...");

        const manifestsResult = await generateManifestsStep(
            analysisResult,
            dockerfileResult,
            lmClient,
            stream,
            token,
            workspacePath,
            {
                acrLoginServer: config.acrLoginServer,
                clusterName: config.clusterName,
            },
        );

        if (!manifestsResult.succeeded) {
            return {
                ok: false,
                error: `Kubernetes manifest generation failed: ${manifestsResult.error}`,
                retryable: true,
            };
        }

        // Step 3: Process manifests with AKS Automatic awareness
        const manifests: Manifest[] = [];
        const manifestFiles = manifestsResult.result.files;

        for (const [filename, content] of Object.entries(manifestFiles)) {
            let processedContent = content;

            // Apply AKS Automatic-specific adaptations
            if (config.clusterSku === "Automatic") {
                processedContent = adaptManifestForAutomatic(processedContent, filename);
            }

            // Skip empty manifests (e.g., HPA for Automatic clusters)
            if (processedContent.trim()) {
                manifests.push({
                    filename,
                    content: processedContent,
                });
            }
        }

        // Step 4: Validate that we have required artifacts
        if (!dockerfile || manifests.length === 0) {
            return {
                ok: false,
                error: "Failed to generate required artifacts (Dockerfile or Kubernetes manifests).",
                retryable: true,
            };
        }

        // Ensure we have at least Deployment and Service
        const hasDeployment = manifests.some((m) => m.content.includes("kind: Deployment"));
        const hasService = manifests.some((m) => m.content.includes("kind: Service"));

        if (!hasDeployment || !hasService) {
            return {
                ok: false,
                error: "Generated manifests must include at least Deployment and Service resources.",
                retryable: true,
            };
        }

        // Step 5: Show next steps
        stream.markdown("### Summary\n\n");
        stream.markdown("✅ Artifacts generated:\n");
        stream.markdown("```\n");
        stream.markdown("📄 Dockerfile\n");
        for (const m of manifests) {
            stream.markdown(`📁 k8s/${m.filename}\n`);
        }
        stream.markdown("```\n\n");
        stream.markdown("Review the files above, then save them to proceed to build.\n");

        const artifacts: ArtifactsData = {
            dockerfile,
            manifests,
            savedToDisk: false,
        };

        return {
            ok: true,
            artifacts,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Prepare phase failed: ${message}`,
            retryable: true,
        };
    }
}

/**
 * Adapts a Kubernetes manifest for AKS Automatic constraints.
 *
 * For Automatic clusters:
 * - Removes resource requests and limits from Pod specs
 * - Changes ingress class to 'webapprouting' (Azure's app routing)
 * - Skips HPA manifest generation
 *
 * @param content The YAML manifest content
 * @param filename The manifest filename (for detecting type)
 * @returns The adapted manifest content
 */
function adaptManifestForAutomatic(content: string, filename: string): string {
    // Skip HPA manifests entirely for Automatic
    if (filename.includes("hpa") || filename.includes("autoscaler")) {
        return ""; // Will be filtered out by caller
    }

    let adapted = content;

    // Remove resource requests and limits from containers
    adapted = adapted.replace(
        /^\s*resources:\s*\n\s*requests:\s*\n[\s\S]*?(?=\n\s*(?:name:|image:|ports:|env:|livenessProbe:|readinessProbe:|volumeMounts:|securityContext:|$))/gm,
        "",
    );

    adapted = adapted.replace(
        /^\s*limits:\s*\n[\s\S]*?(?=\n\s*(?:name:|image:|ports:|env:|livenessProbe:|readinessProbe:|volumeMounts:|securityContext:|$))/gm,
        "",
    );

    // Change ingress class to webapprouting for Automatic
    if (adapted.includes("kind: Ingress")) {
        // Replace existing ingressClassName if present
        adapted = adapted.replace(/^\s*ingressClassName:\s*.+$/m, "  ingressClassName: webapprouting");

        // If no ingressClassName was found, add it under metadata
        if (!adapted.includes("ingressClassName:")) {
            adapted = adapted.replace(
                /^(\s*metadata:[\s\S]*?name:.*\n)/m,
                (match) => `${match}  ingressClassName: webapprouting\n`,
            );
        }
    }

    // Remove empty resources sections that may be left over
    adapted = adapted.replace(/^\s*resources:\s*\n(?=\s*(?:name:|image:|ports:|env:|$))/gm, "");

    return adapted;
}
