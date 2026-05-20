import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { PhaseResult } from "../phaseRunner";
import { ConfigData, DeploymentData, VerificationData } from "../state";
import { invokeKubectlCommand, getResources } from "../../../commands/utils/kubectl";
import { failed } from "../../../commands/utils/errorable";
import { acquireKubeconfigFile } from "../kubeconfig";
import { NonZeroExitCodeBehaviour } from "../../../commands/utils/shell";

/**
 * Kubernetes Pod object
 */
interface KubernetesPod {
    metadata?: {
        name?: string;
        namespace?: string;
    };
    status?: {
        phase?: string;
        conditions?: Array<{
            type?: string;
            status?: string;
        }>;
    };
}

/**
 * Kubernetes Service object
 */
interface KubernetesService {
    metadata?: {
        name?: string;
        namespace?: string;
    };
    spec?: {
        selector?: Record<string, string>;
        type?: string;
    };
    status?: {
        loadBalancer?: {
            ingress?: Array<{
                ip?: string;
                hostname?: string;
            }>;
        };
    };
}

/**
 * Verifies the deployment is healthy by checking pod status and service endpoints.
 *
 * This phase:
 * 1. Gets the kubectl API and current kubeconfig
 * 2. Checks pod status (Running, Ready conditions)
 * 3. Checks service endpoints availability
 * 4. Scans container logs for errors
 * 5. Streams a summary of verification results
 * 6. Returns VerificationData to be stored in kickstart state
 *
 * @param workspaceFolder The workspace folder URI
 * @param deployment Deployment data from the DEPLOY phase containing applied manifests
 * @param config Configuration data containing cluster information
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with VerificationData on success
 */
export async function verifyPhase(
    _workspaceFolder: vscode.Uri,
    deployment: DeploymentData,
    config: ConfigData,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<PhaseResult & { verification?: VerificationData }> {
    try {
        stream.markdown("✅ **Verifying deployment health**\n\n");
        stream.markdown(`Checking deployment of ${deployment.appliedManifests.length} manifest(s)...\n\n`);

        if (token.isCancellationRequested) {
            return {
                ok: false,
                error: "Verification cancelled.",
                retryable: false,
            };
        }

        // Step 1: Get kubectl API
        const kubectl = await k8s.extension.kubectl.v1;
        if (!kubectl.available) {
            return {
                ok: false,
                error: "kubectl is unavailable. Ensure the Kubernetes extension is installed.",
                retryable: true,
            };
        }

        // Step 2: Acquire authenticated kubeconfig for the cluster (Azure SDK path,
        // shared with the DEPLOY phase — does not rely on the user's local kubectl context).
        const kubeConfigResult = await acquireKubeconfigFile(config);
        if (failed(kubeConfigResult)) {
            return { ok: false, error: kubeConfigResult.error, retryable: true };
        }
        const kubeConfigFile = kubeConfigResult.result;

        try {
            stream.markdown("### Pod Status\n\n");
            stream.progress("Checking pod status...");

            // Step 3: Check pod status in default namespace
            const namespace = "default";
            const podsResult = await getResources<KubernetesPod>(kubectl, kubeConfigFile.filePath, "pods", namespace);

            if (failed(podsResult)) {
                return {
                    ok: false,
                    error: `Could not fetch pods: ${podsResult.error}`,
                    retryable: true,
                };
            }

            const pods = podsResult.result;

            // If no pods deployed, this is a failure
            if (pods.length === 0) {
                stream.markdown("⚠️ **No pods found in default namespace**\n\n");
                return {
                    ok: false,
                    error: "No pods were deployed. Check that manifests were applied correctly.",
                    retryable: true,
                };
            }

            // Render pod status table
            let podTable = "| Pod Name | Status | Ready | Phase |\n";
            podTable += "|----------|--------|-------|-------|\n";

            let allPodsReady = true;
            const podDetails: Array<{ name: string; phase: string; ready: boolean }> = [];

            for (const pod of pods) {
                const podName = pod.metadata?.name ?? "(unknown)";
                const phase = pod.status?.phase ?? "Unknown";
                const conditions = pod.status?.conditions || [];
                const readyCondition = conditions.find((c) => c.type === "Ready");
                const isReady = readyCondition?.status === "True";

                if (!isReady || phase !== "Running") {
                    allPodsReady = false;
                }

                const statusIcon = isReady && phase === "Running" ? "✅" : "⚠️";
                const readyIcon = isReady ? "✅" : "❌";

                podTable += `| ${podName} | ${statusIcon} ${phase} | ${readyIcon} | ${phase} |\n`;
                podDetails.push({ name: podName, phase, ready: isReady });
            }

            stream.markdown(podTable);

            // Step 4: Check service endpoints
            stream.markdown("\n### Service Endpoints\n\n");

            const servicesResult = await getResources<KubernetesService>(
                kubectl,
                kubeConfigFile.filePath,
                "services",
                namespace,
            );

            if (failed(servicesResult)) {
                return {
                    ok: false,
                    error: `Could not fetch services: ${servicesResult.error}`,
                    retryable: true,
                };
            }

            const services = servicesResult.result.filter((svc) => svc.metadata?.name !== "kubernetes");

            let serviceEndpoint: string | undefined;

            if (services.length === 0) {
                stream.markdown("ℹ️ **No services found in default namespace**\n\n");
            } else {
                let serviceTable = "| Service Name | Type | Endpoint |\n";
                serviceTable += "|--------------|------|----------|\n";

                for (const svc of services) {
                    const svcName = svc.metadata?.name ?? "(unknown)";
                    const svcType = svc.spec?.type ?? "ClusterIP";

                    let endpoint = "Pending";
                    const ingress = svc.status?.loadBalancer?.ingress || [];

                    if (ingress.length > 0) {
                        const ingressEntry = ingress[0];
                        endpoint = ingressEntry.ip || ingressEntry.hostname || "Pending";
                        serviceEndpoint = endpoint;
                    } else if (svcType === "ClusterIP") {
                        endpoint = "Internal";
                    }

                    const endpointIcon = endpoint !== "Pending" ? "✅" : "⏳";
                    serviceTable += `| ${svcName} | ${svcType} | ${endpointIcon} ${endpoint} |\n`;
                }

                stream.markdown(serviceTable);
            }

            // Step 5: Check container logs for errors
            stream.markdown("\n### Container Logs\n\n");

            let logsHaveErrors = false;

            for (const podDetail of podDetails) {
                const logsResult = await invokeKubectlCommand(
                    kubectl,
                    kubeConfigFile.filePath,
                    `logs -n ${namespace} ${podDetail.name} --tail=50 2>/dev/null`,
                    NonZeroExitCodeBehaviour.Succeed,
                );

                if (!failed(logsResult) && logsResult.result.stdout) {
                    const logs = logsResult.result.stdout;
                    const hasError = /error|failed|exception|panic/i.test(logs);

                    if (hasError) {
                        logsHaveErrors = true;
                        stream.markdown(`⚠️ **${podDetail.name}** - Potential errors detected\n\n`);
                        stream.markdown(`\`\`\`\n${logs.substring(0, 500)}...\n\`\`\`\n\n`);
                    } else {
                        stream.markdown(`✅ **${podDetail.name}** - No obvious errors in logs\n\n`);
                    }
                }
            }

            // Step 6: Prepare verification result
            stream.markdown("### Verification Summary\n\n");

            const verification: VerificationData = {
                podsReady: allPodsReady,
                serviceEndpoint: serviceEndpoint,
            };

            if (allPodsReady) {
                stream.markdown("✅ **Deployment verified!**\n\n");
                stream.markdown("Your application is running and healthy on the AKS cluster.\n\n");

                if (serviceEndpoint) {
                    stream.markdown(`🌐 **Service Endpoint:** \`${serviceEndpoint}\`\n\n`);
                    stream.markdown("You can access your application at the endpoint above.\n\n");
                } else {
                    stream.markdown(
                        "**Note:** The service does not yet have an external endpoint. It may still be loading.\n\n",
                    );
                }

                return {
                    ok: true,
                    verification,
                };
            } else {
                stream.markdown("❌ **Issues found during verification**\n\n");

                if (pods.some((p) => p.status?.phase === "Pending")) {
                    stream.markdown(
                        "- **Pods pending:** They are still starting up. This usually resolves in 1-2 minutes.\n",
                    );
                    stream.markdown("  Run `kubectl get pods` to check status, or wait and retry.\n\n");
                }

                if (pods.some((p) => p.status?.phase === "CrashLoopBackOff")) {
                    stream.markdown("- **Pod crash loop:** The container is crashing. Check the logs for errors.\n");
                    stream.markdown("  Run `kubectl logs -f <pod-name>` to see the error details.\n\n");
                }

                if (logsHaveErrors) {
                    stream.markdown("- **Container errors:** Check the logs above for application errors.\n\n");
                }

                stream.markdown("### Troubleshooting\n\n");
                stream.markdown("Try these steps:\n");
                stream.markdown("1. **Wait for pods to become ready:** `kubectl get pods --watch`\n");
                stream.markdown("2. **Check pod logs:** `kubectl logs -f <pod-name>`\n");
                stream.markdown("3. **Describe a pod:** `kubectl describe pod <pod-name>`\n");
                stream.markdown("4. **Check events:** `kubectl get events --sort-by='.lastTimestamp'`\n\n");

                return {
                    ok: false,
                    error: "Deployment has issues. Check the logs and status above.",
                    retryable: true,
                    verification,
                };
            }
        } finally {
            // Clean up temp kubeconfig file
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(kubeConfigFile.filePath));
            } catch {
                // Ignore cleanup errors
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Verification phase failed: ${message}`,
            retryable: true,
        };
    }
}
