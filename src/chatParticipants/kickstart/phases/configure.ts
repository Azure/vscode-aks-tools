import * as vscode from "vscode";
import { configureKickstart } from "../../../commands/aksKickstart/configure";
import { failed } from "../../../commands/utils/errorable";
import { PhaseResult } from "../phaseRunner";
import { ConfigData } from "../state";
import { getAssetContext } from "../../../assets";

/** Result of a single pre-flight check. */
type CheckStatus = "granted" | "missing" | "inconclusive" | "warning";

const STATUS_ICON: Record<CheckStatus, string> = { granted: "✅", missing: "❌", inconclusive: "⚠️", warning: "💡" };

function statusOf(granted: boolean, inconclusive: boolean): CheckStatus {
    if (inconclusive) return "inconclusive";
    return granted ? "granted" : "missing";
}

interface PreflightCheck {
    label: string;
    status: CheckStatus;
    detail: string;
}

function check(label: string, status: CheckStatus, details: Partial<Record<CheckStatus, string>>): PreflightCheck {
    return { label, status, detail: details[status] ?? "" };
}

/** Escape pipes/newlines so dynamic text can't break the markdown table. */
function escapeCell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderPreflightTable(stream: vscode.ChatResponseStream, checks: readonly PreflightCheck[]): void {
    const header = "| Status | Check | Detail |\n|:------:|-------|--------|\n";
    const rows = checks
        .map((c) => `| ${STATUS_ICON[c.status]} | ${escapeCell(c.label)} | ${escapeCell(c.detail)} |`)
        .join("\n");
    stream.markdown(`${header}${rows}\n`);
}

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

        const rbac = kickstartConfig.userDeployRbac;
        const config: ConfigData = {
            subscriptionId: kickstartConfig.subscriptionId,
            resourceGroup: kickstartConfig.resourceGroup,
            clusterName: kickstartConfig.clusterName,
            clusterSku: kickstartConfig.isAutomatic ? "Automatic" : "Standard",
            acrName: kickstartConfig.acrKey.acrName,
            acrLoginServer: kickstartConfig.acrLoginServer,
            canGetKubeconfig: kickstartConfig.canGetKubeconfig,
            hasAcrPull: kickstartConfig.hasAcrPull,
            azureRbacEnabled: rbac?.azureRbacEnabled ?? kickstartConfig.isAutomatic,
            hasAksDeployRole: rbac?.hasDeployRole ?? false,
            aksDeployRoleNames: rbac?.matchingDeployRoles ?? [],
            clusterRbacInconclusive: rbac?.clusterScopeInconclusive ?? true,
            hasAcrPushRole: rbac?.hasAcrPushRole ?? false,
            hasAcrTasksContributorRole: rbac?.hasAcrTasksContributorRole ?? false,
            acrRbacInconclusive: rbac?.acrScopeInconclusive ?? true,
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

        const checks: PreflightCheck[] = [
            check("Cluster SKU", config.clusterSku === "Automatic" ? "warning" : "granted", {
                granted: "AKS Standard",
                missing: "AKS Standard",
                warning:
                    "AKS Automatic — Azure manages node pools, scaling, and upgrades. Some Kickstart features may behave differently.",
                inconclusive: "Could not determine cluster SKU.",
            }),
            check("Kubeconfig access (you → cluster)", config.canGetKubeconfig ? "granted" : "missing", {
                granted: "Available",
                missing: "Denied. Ensure you have the **Azure Kubernetes Service Cluster User Role** on the cluster.",
                inconclusive: "Could not verify.",
            }),
            check("ACR pull permission (cluster → registry)", statusOf(config.hasAcrPull, false), {
                granted: "Configured (cluster kubelet identity has AcrPull)",
                missing: "The cluster does not have **AcrPull** on this registry. Attach it from the Azure Portal.",
                inconclusive: "Could not verify.",
            }),
            check("ACR push permission (you → registry)", statusOf(config.hasAcrPushRole, config.acrRbacInconclusive), {
                granted: "Granted (**AcrPush**)",
                missing: "Missing. You need **AcrPush** on the registry to push images during the build phase.",
                inconclusive: "Could not verify; build may fail with a forbidden error if **AcrPush** is missing.",
            }),
            check(
                "ACR tasks permission (you → registry)",
                statusOf(config.hasAcrTasksContributorRole, config.acrRbacInconclusive),
                {
                    granted: "Granted (**Container Registry Tasks Contributor**)",
                    missing:
                        "Missing. `az acr build` requires **Container Registry Tasks Contributor** on the registry.",
                    inconclusive: "Could not verify; `az acr build` may fail with a forbidden error.",
                },
            ),
        ];

        // Azure RBAC for Kubernetes is only relevant when enabled (always on for AKS Automatic);
        // on Standard clusters without it, `kubectl apply` is authorized via Kubernetes RBAC.
        if (config.azureRbacEnabled) {
            const grantedDetail =
                config.aksDeployRoleNames.length > 0 ? `Granted (${config.aksDeployRoleNames.join(", ")})` : "Granted";
            checks.push(
                check(
                    "Cluster deploy permission (Azure RBAC, you → cluster)",
                    statusOf(config.hasAksDeployRole, config.clusterRbacInconclusive),
                    {
                        granted: grantedDetail,
                        missing:
                            "Missing. `kubectl apply` requires one of **AKS RBAC Writer**, **RBAC Admin**, or " +
                            "**RBAC Cluster Admin** on the cluster. Owner/Contributor on the AKS resource do NOT grant Kubernetes write.",
                        inconclusive:
                            "Could not verify. Deployment will proceed, but if it fails with a forbidden error, " +
                            "ask your admin to assign **AKS RBAC Writer** on the cluster.",
                    },
                ),
            );
        }

        renderPreflightTable(stream, checks);

        if (!config.canGetKubeconfig) {
            return {
                ok: false,
                error: "You do not have permission to access kubeconfig for this cluster. Ensure you have the **Azure Kubernetes Service Cluster User Role**.",
                retryable: false,
            };
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
