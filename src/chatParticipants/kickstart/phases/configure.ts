import * as vscode from "vscode";
import { configureKickstart } from "../../../commands/aksKickstart/configure";
import { failed } from "../../../commands/utils/errorable";
import { PhaseResult } from "../phaseRunner";
import { ConfigData } from "../state";
import { getAssetContext } from "../../../assets";

/**
 * Configures the cluster and container registry for the kickstart workflow.
 *
 * This phase:
 * 1. Runs the existing QuickPick flow to select subscription, cluster, and registry
 * 2. Performs pre-flight checks (cluster SKU, kubeconfig access, ACR permissions)
 * 3. Validates that all selections are made and checks pass
 * 4. Streams a summary of the configuration to the user
 * 5. Returns ConfigData to be stored in kickstart state
 *
 * @param stream The chat response stream for progress updates
 * @param token Cancellation token to stop execution
 * @returns PhaseResult with ConfigData on success
 */
export async function configurePhase(
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<PhaseResult & { config?: ConfigData }> {
    try {
        if (token.isCancellationRequested) {
            return {
                ok: false,
                error: "Configuration cancelled.",
                retryable: false,
            };
        }

        stream.markdown("🔧 **Configuring Azure resources**\n\n");

        const extensionContext = getAssetContext();
        const configResult = await configureKickstart(extensionContext ?? undefined);

        if (failed(configResult)) {
            if (configResult.error === "Cancelled.") {
                return {
                    ok: false,
                    error: "Configuration cancelled.",
                    retryable: false,
                };
            }

            return {
                ok: false,
                error: configResult.error,
                retryable: true,
            };
        }

        const kickstartConfig = configResult.result;

        if (!kickstartConfig.subscriptionId || !kickstartConfig.clusterKey || !kickstartConfig.acrKey) {
            return {
                ok: false,
                error: "Missing required configuration data. Please ensure subscription, cluster, and registry were selected.",
                retryable: true,
            };
        }

        if (!kickstartConfig.canGetKubeconfig) {
            return {
                ok: false,
                error: "You do not have permission to access kubeconfig for this cluster. Ensure you have the 'Azure Kubernetes Service Cluster User Role'.",
                retryable: false,
            };
        }

        const config: ConfigData = {
            subscriptionId: kickstartConfig.subscriptionId,
            resourceGroup: kickstartConfig.resourceGroup,
            clusterName: kickstartConfig.clusterName,
            clusterSku: kickstartConfig.isAutomatic ? "Automatic" : "Standard",
            acrName: kickstartConfig.acrKey.acrName,
            acrLoginServer: kickstartConfig.acrLoginServer,
            canGetKubeconfig: kickstartConfig.canGetKubeconfig,
            hasAcrPull: kickstartConfig.hasAcrPull,
        };

        stream.markdown("### Configuration Summary\n\n");

        let summaryTable = "| Resource | Value |\n";
        summaryTable += "|----------|-------|\n";
        summaryTable += `| **Subscription** | ${kickstartConfig.subscriptionId} |\n`;
        summaryTable += `| **Resource Group** | ${config.resourceGroup} |\n`;
        summaryTable += `| **Cluster** | ${config.clusterName} |\n`;
        summaryTable += `| **Registry** | ${config.acrName} |\n`;
        summaryTable += `| **Login Server** | ${config.acrLoginServer} |\n`;

        stream.markdown(summaryTable);

        stream.markdown("\n### Pre-flight Checks\n\n");

        const skuLabel = config.clusterSku === "Automatic" ? "AKS Automatic" : "AKS Standard";
        const skuIcon = config.clusterSku === "Automatic" ? "⚠️" : "✅";
        stream.markdown(`${skuIcon} **Cluster SKU:** ${skuLabel}`);
        if (config.clusterSku === "Automatic") {
            stream.markdown(
                "  > AKS Automatic manages node pools, scaling, and upgrades. Some Kickstart features may behave differently.",
            );
        }
        stream.markdown("");

        const kubeconfigIcon = config.canGetKubeconfig ? "✅" : "❌";
        stream.markdown(`${kubeconfigIcon} **Kubeconfig access:** ${config.canGetKubeconfig ? "Available" : "Denied"}`);
        if (!config.canGetKubeconfig) {
            stream.markdown(
                "  > You do not have permission to get kubeconfig credentials for this cluster. Ensure you have the **Azure Kubernetes Service Cluster User Role**.",
            );
        }
        stream.markdown("");

        const acrPullIcon = config.hasAcrPull ? "✅" : "⚠️";
        stream.markdown(
            `${acrPullIcon} **ACR Pull permission:** ${config.hasAcrPull ? "Configured" : "Not configured"}`,
        );
        if (!config.hasAcrPull) {
            stream.markdown(
                "  > The cluster does not have AcrPull on this registry. You can attach it using Azure Portal.",
            );
        }

        return {
            ok: true,
            config,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Configuration phase failed: ${message}`,
            retryable: true,
        };
    }
}
