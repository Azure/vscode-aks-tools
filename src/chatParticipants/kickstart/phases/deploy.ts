import * as vscode from "vscode";
import * as path from "path";
import * as k8s from "vscode-kubernetes-tools-api";
import { invokeKubectlCommand } from "../../../commands/utils/kubectl";
import { getAuthenticatedKubeconfigYaml } from "../../../commands/utils/clusters";
import { failed } from "../../../commands/utils/errorable";
import { createTempFile } from "../../../commands/utils/tempfile";
import { NonZeroExitCodeBehaviour } from "../../../commands/utils/shell";
import { PhaseResult } from "../phaseRunner";
import { ArtifactsData, ConfigData, ImageData, DeploymentData } from "../state";

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
    _token: vscode.CancellationToken,
): Promise<PhaseResult & { deployment?: DeploymentData }> {
    try {
        const workspacePath = workspaceFolder.fsPath;

        // Entry validation
        stream.markdown("🚀 **Deploying to AKS**\n\n");

        // Check manifests are saved
        if (!artifacts.savedToDisk || !artifacts.manifests || artifacts.manifests.length === 0) {
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

        // Get authenticated kubeconfig
        let kubeconfigYaml: string;
        try {
            const cfgResult = await kubectl.api.invokeCommand("config view --minify --flatten -o yaml");
            if (!cfgResult || cfgResult.code !== 0) {
                return {
                    ok: false,
                    error: `Could not read kubeconfig for cluster '${config.clusterName}'.`,
                    retryable: true,
                };
            }

            const authenticatedConfig = await getAuthenticatedKubeconfigYaml(cfgResult.stdout);
            if (failed(authenticatedConfig)) {
                return {
                    ok: false,
                    error: `Could not authenticate kubeconfig: ${authenticatedConfig.error}`,
                    retryable: true,
                };
            }

            kubeconfigYaml = authenticatedConfig.result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                error: `Failed to prepare kubeconfig: ${message}`,
                retryable: true,
            };
        }

        // Create temporary kubeconfig file
        const kubeConfigFile = await createTempFile(kubeconfigYaml, "yaml");

        try {
            // Determine manifests directory
            const manifestsDir = path.join(workspacePath, "k8s");

            // Skip namespace creation for AKS Automatic (it manages namespaces automatically)
            if (config.clusterSku === "Automatic") {
                stream.markdown("ℹ️ **AKS Automatic Note:**\n");
                stream.markdown(
                    "- Namespaces are managed automatically by AKS Automatic\n" +
                        "- Node provisioning may take 2-3 minutes on first deployment\n" +
                        "- Pods may remain in Pending state while nodes are being provisioned\n\n",
                );
            }

            // Apply manifests to the cluster
            stream.markdown(`### Applying manifests to **${config.clusterName}**\n\n`);

            const applyResult = await invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `apply -f "${manifestsDir}" --record`,
                NonZeroExitCodeBehaviour.Succeed,
            );

            if (failed(applyResult)) {
                return {
                    ok: false,
                    error: `Failed to apply manifests: ${applyResult.error}`,
                    retryable: true,
                };
            }

            if (applyResult.result.code !== 0) {
                const errorMsg = applyResult.result.stderr || applyResult.result.stdout;
                return {
                    ok: false,
                    error: `kubectl apply failed: ${errorMsg}`,
                    retryable: true,
                };
            }

            // Get the apply output to show to user
            const applyOutput = applyResult.result.stdout.trim();
            if (applyOutput) {
                stream.markdown(`\`\`\`\n${applyOutput}\n\`\`\`\n\n`);
            }

            // List applied resources
            stream.markdown("### Applied Resources\n\n");

            const listResult = await invokeKubectlCommand(
                kubectl,
                kubeConfigFile.filePath,
                `get all -A`,
                NonZeroExitCodeBehaviour.Succeed,
            );

            if (!failed(listResult) && listResult.result.code === 0) {
                const resourceList = listResult.result.stdout.trim();
                if (resourceList) {
                    stream.markdown(`\`\`\`\n${resourceList}\n\`\`\`\n\n`);
                }
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
            const appliedManifests = artifacts.manifests?.map((m) => m.filename) || [];

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
