import * as vscode from "vscode";
import * as path from "path";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../../../commands/utils/errorable";
import { acquireKubeconfigFile } from "../kubeconfig";
import { PhaseResult } from "../phaseRunner";
import { ArtifactsData, ConfigData, ImageData, DeploymentData } from "../state";
import { runInTerminal } from "../terminalTool";

/**
 * Deploys Kubernetes manifests to the AKS cluster.
 *
 * This phase:
 * 1. Validates that manifests are saved on disk
 * 2. Validates that the container image has been built and pushed
 * 3. Validates kubeconfig access
 * 4. Applies manifests to the cluster using kubectl apply
 * 5. For AKS Automatic clusters, provides guidance about node provisioning delays
 * 6. Lists applied resources and streams cluster portal link
 * 7. Returns DeploymentData with applied manifest list and timestamp
 *
 * @param workspaceFolder The workspace folder URI
 * @param artifacts Project artifacts (Dockerfile and manifests) from PREPARE phase
 * @param config Cluster and registry configuration from CONFIGURE phase
 * @param image Built and pushed container image from BUILD phase
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with DeploymentData on success
 */
export async function deployPhase(
    workspaceFolder: vscode.Uri,
    artifacts: ArtifactsData,
    config: ConfigData,
    image: ImageData,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    request: vscode.ChatRequest,
): Promise<PhaseResult & { deployment?: DeploymentData }> {
    try {
        if (token.isCancellationRequested) {
            return { ok: false, error: "Deployment cancelled.", retryable: false };
        }

        const workspacePath = workspaceFolder.fsPath;

        // Entry validation
        stream.markdown("🚀 **Deploying to AKS**\n\n");

        // Check manifests are saved
        if (!artifacts.savedToDisk || artifacts.stagedFiles.length === 0) {
            return {
                ok: false,
                error: "Manifests have not been saved to disk. Please save the generated manifests before deploying.",
                retryable: false,
            };
        }

        // Check image was built
        if (!image || !image.repository || !image.tag) {
            return {
                ok: false,
                error: "Container image has not been built and pushed. Please complete the Build phase first.",
                retryable: false,
            };
        }

        // Check kubeconfig access
        if (!config.canGetKubeconfig) {
            return {
                ok: false,
                error: "You do not have permission to access kubeconfig for this cluster. Ensure you have the 'Azure Kubernetes Service Cluster User Role'.",
                retryable: false,
            };
        }

        // Get kubectl API
        const kubectl = await k8s.extension.kubectl.v1;
        if (!kubectl.available) {
            return {
                ok: false,
                error: "kubectl is not available. Please ensure kubectl is installed and configured.",
                retryable: true,
            };
        }

        // Acquire authenticated kubeconfig (written to a temp file ready for kubectl --kubeconfig=...)
        const kubeConfigResult = await acquireKubeconfigFile(config);
        if (failed(kubeConfigResult)) {
            return { ok: false, error: kubeConfigResult.error, retryable: true };
        }
        const kubeConfigFile = kubeConfigResult.result;

        try {
            // Determine manifest directories. Monorepo modules have manifests under
            // "<module>/k8s/"; single-module projects have them at the workspace root "k8s/".
            const isManifestFilename = (filename: string): boolean => /(^|\/)k8s\//.test(filename);
            const manifestDirsRel = new Set<string>();
            for (const sf of artifacts.stagedFiles) {
                if (!isManifestFilename(sf.filename)) continue;
                const idx = sf.filename.lastIndexOf("k8s/");
                const dirRel = idx > 0 ? `${sf.filename.substring(0, idx)}k8s` : "k8s";
                manifestDirsRel.add(dirRel);
            }
            if (manifestDirsRel.size === 0) {
                // Fall back to default location (backward compat with non-staged flows)
                manifestDirsRel.add("k8s");
            }
            const manifestDirs = [...manifestDirsRel].map((d) => path.join(workspacePath, d));

            // Skip namespace creation for AKS Automatic (it manages namespaces automatically)
            if (config.clusterSku === "Automatic") {
                stream.markdown("ℹ️ **AKS Automatic Note:**\n");
                stream.markdown(
                    "- Namespaces are managed automatically by AKS Automatic\n" +
                        "- Node provisioning may take 2-3 minutes on first deployment\n" +
                        "- Pods may remain in Pending state while nodes are being provisioned\n\n",
                );
            }

            stream.markdown(`### Applying manifests to **${config.clusterName}**\n\n`);
            if (manifestDirs.length > 1) {
                stream.markdown(`Applying manifests from ${manifestDirs.length} module directories:\n`);
                for (const d of manifestDirs) {
                    stream.markdown(`- \`${d}\`\n`);
                }
                stream.markdown("\n");
            }
            stream.progress("Applying manifests to cluster...");

            const fFlags = manifestDirs.map((d) => `-f "${d}"`).join(" ");
            const applyCommand = `kubectl apply ${fFlags} --kubeconfig="${kubeConfigFile.filePath}"`;
            const applyResult = await runInTerminal(applyCommand, workspacePath, token, request.toolInvocationToken);

            if (!applyResult.succeeded) {
                return {
                    ok: false,
                    error: `Failed to apply manifests: ${applyResult.error}`,
                    retryable: true,
                };
            }

            stream.markdown("### Applied Resources\n\n");

            const listCommand = `kubectl get all -A --kubeconfig="${kubeConfigFile.filePath}"`;
            const listResult = await runInTerminal(listCommand, workspacePath, token, request.toolInvocationToken);

            if (listResult.succeeded && listResult.result.trim()) {
                stream.markdown(`\`\`\`\n${listResult.result.trim()}\n\`\`\`\n\n`);
            }

            // Stream cluster portal link
            stream.markdown("### Next Steps\n\n");

            const portalUrl = `https://portal.azure.com/#@microsoft.com/resource/subscriptions/${config.subscriptionId}/resourcegroups/${config.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${config.clusterName}/overview`;

            stream.anchor(vscode.Uri.parse(portalUrl), "Open cluster in Azure Portal");
            stream.markdown("\n");

            stream.markdown("1. Check pod status: `kubectl get pods -A`\n");
            stream.markdown("2. View logs: `kubectl logs -n default <pod-name>`\n");
            stream.markdown(
                "3. Port-forward to test: `kubectl port-forward -n default svc/<service-name> 8080:80`\n\n",
            );

            if (config.clusterSku === "Automatic") {
                stream.markdown(
                    "⏳ **Waiting for nodes?** AKS Automatic provisions nodes on-demand. If pods are pending, check back in a few minutes.\n\n",
                );
            }

            // Build list of applied manifests for tracking
            const appliedManifests = artifacts.stagedFiles
                .filter((f) => isManifestFilename(f.filename))
                .map((f) => f.filename);

            // Create deployment data
            const deployment: DeploymentData = {
                appliedManifests,
                timestamp: Date.now(),
            };

            stream.markdown("✅ **Deployment complete!** Manifests have been applied to the cluster.\n\n");

            return {
                ok: true,
                deployment,
            };
        } finally {
            kubeConfigFile.dispose();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Deploy phase failed: ${message}`,
            retryable: true,
        };
    }
}
