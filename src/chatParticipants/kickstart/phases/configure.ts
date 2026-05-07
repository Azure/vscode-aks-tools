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
            return { ok: false, error: "Configuration cancelled.", retryable: false };
        }

        stream.markdown("🔧 **Configuring Azure resources**\n\n");
        stream.progress("Waiting for cluster choice...");

        const clusterChoice = await vscode.window.showQuickPick(
            [
                {
                    label: "$(cloud) Use existing cluster",
                    description: "Select from your Azure subscriptions",
                    value: "existing" as const,
                },
                {
                    label: "$(add) Create a new AKS Automatic cluster",
                    description: "Recommended — Azure manages scaling, upgrades, and node pools",
                    value: "create" as const,
                },
            ],
            { placeHolder: "How would you like to set up your AKS cluster?", ignoreFocusOut: true },
        );

        if (!clusterChoice) {
            return { ok: false, error: "Configuration cancelled.", retryable: false };
        }

        if (clusterChoice.value === "create") {
            stream.markdown(
                "### Create a New Cluster\n\n" +
                    "Opening the cluster creation wizard. After your cluster is ready, " +
                    "say **configure** to continue.\n\n",
            );
            stream.button({ command: "aks.createCluster", title: "🆕 Create cluster (guided wizard)" });
            stream.button({ command: "aks.aksCreateClusterFromCopilot", title: "🤖 Create with Copilot" });
            return {
                ok: false,
                error: "Cluster creation in progress. Say 'configure' when your cluster is ready.",
                retryable: true,
            };
        }

        stream.progress("Loading Azure subscriptions...");

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

            if (
                configResult.error.includes("No AKS clusters") ||
                configResult.error.includes("No container registries")
            ) {
                return {
                    ok: false,
                    error: `${configResult.error}\n\nTip: Say **create cluster** to set up a new AKS cluster, or select a different subscription.`,
                    retryable: true,
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

        let summaryTable = "| Component | Resource | Detail |\n";
        summaryTable += "|-----------|----------|--------|\n";
        summaryTable += `| Compute | ${config.clusterName} | ${config.clusterSku === "Automatic" ? "AKS Automatic" : "AKS Standard"} |\n`;
        summaryTable += `| Registry | ${config.acrName} | ${config.acrLoginServer} |\n`;
        summaryTable += `| Resource Group | ${config.resourceGroup} | ${kickstartConfig.subscriptionId} |\n`;

        stream.markdown(summaryTable);

        if (config.clusterSku === "Automatic") {
            stream.markdown(
                "\n> 💡 **AKS Automatic** — Azure manages node pools, scaling, and upgrades. " +
                    "Generated manifests will omit resource limits and use managed ingress.\n",
            );
        }

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

        await renderCostEstimate(stream, config);

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

async function fetchAzurePrice(serviceName: string, skuName: string, region: string): Promise<number | undefined> {
    const filter = `serviceName eq '${serviceName}' and armSkuName eq '${skuName}' and armRegionName eq '${region}' and priceType eq 'Consumption'`;
    const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}&$top=1`;
    try {
        const response = await fetch(url);
        if (!response.ok) return undefined;
        const data = (await response.json()) as { Items?: { retailPrice?: number }[] };
        return data.Items?.[0]?.retailPrice;
    } catch {
        return undefined;
    }
}

async function renderCostEstimate(stream: vscode.ChatResponseStream, config: ConfigData): Promise<void> {
    stream.markdown("\n### Estimated Monthly Cost\n\n");

    const acrSkuPrices: Record<string, number> = { Basic: 5, Standard: 20, Premium: 50 };
    const acrEstimate = acrSkuPrices.Basic;

    let aksEstimate: string;
    if (config.clusterSku === "Automatic") {
        aksEstimate = "~$70+ (base fee + per-node)";
    } else {
        const hourlyPrice = await fetchAzurePrice("Azure Kubernetes Service", "Standard_D4s_v3", "eastus");
        if (hourlyPrice) {
            aksEstimate = `~$${Math.round(hourlyPrice * 730)}/mo (Standard_D4s_v3)`;
        } else {
            aksEstimate = "~$140 (typical Standard_D4s_v3)";
        }
    }

    let table = "| Resource | SKU | Est. Monthly |\n";
    table += "|----------|-----|-------------|\n";
    table += `| AKS cluster | ${config.clusterSku === "Automatic" ? "Automatic" : "Standard"} | ${aksEstimate} |\n`;
    table += `| Container Registry | Basic | ~$${acrEstimate} |\n`;

    stream.markdown(table);
    stream.markdown("\n*Estimates based on Azure Retail Prices. Actual costs depend on usage.*\n");
    stream.anchor(
        vscode.Uri.parse("https://azure.microsoft.com/en-us/pricing/calculator/"),
        "Azure Pricing Calculator",
    );
}
