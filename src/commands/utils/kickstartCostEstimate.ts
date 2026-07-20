import * as l10n from "@vscode/l10n";
import { CostEstimate, CostEstimateLineItem } from "../../webview-contract/webviewDefinitions/kickstartCluster";
import { REQUIRED_VCPUS_FOR_AUTOMATIC, normalizeLocation } from "./clusterPreflight";
import { Errorable, failed } from "./errorable";
import { RetailPriceItem, fetchRetailPrices } from "./retailPrices";

const HOURS_PER_MONTH = 730;
const DAYS_PER_MONTH = 365 / 12;
const BASELINE_VCPUS = REQUIRED_VCPUS_FOR_AUTOMATIC;
const REPRESENTATIVE_NODE_SKU = "Standard_D4s_v5";
const REPRESENTATIVE_NODE_VCPUS = 4;
const CURRENCY_CODE = "USD";

function controlPlaneFilter(region: string): string {
    return `serviceName eq 'Azure Kubernetes Service' and armRegionName eq '${region}' and skuName eq 'Automatic' and meterName eq 'Automatic Hosted Control Plane'`;
}

function nodeSurchargeFilter(region: string): string {
    return `serviceName eq 'Azure Kubernetes Service' and armRegionName eq '${region}' and meterName eq 'Automatic General Purpose'`;
}

function nodeComputeFilter(region: string): string {
    return `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${REPRESENTATIVE_NODE_SKU}' and priceType eq 'Consumption'`;
}

function acrFilter(): string {
    return `serviceName eq 'Container Registry' and skuName eq 'Basic' and meterName eq 'Basic Registry Unit'`;
}

function firstPriced(items: RetailPriceItem[]): RetailPriceItem | undefined {
    return items.find((item) => item.retailPrice > 0);
}

function isStandardLinuxOnDemand(item: RetailPriceItem): boolean {
    if (item.type !== "Consumption") return false;
    if ((item.productName ?? "").includes("Windows")) return false;
    if ((item.skuName ?? "").includes("Spot")) return false;
    if ((item.skuName ?? "").includes("Low Priority")) return false;
    return true;
}

function formatRate(value: number): string {
    return `$${Number(value.toFixed(4))}`;
}

export async function estimateClusterMonthlyCost(location: string): Promise<Errorable<CostEstimate>> {
    const region = normalizeLocation(location);

    const controlPlaneResult = await fetchRetailPrices(controlPlaneFilter(region));
    if (failed(controlPlaneResult)) return controlPlaneResult;
    const nodeComputeResult = await fetchRetailPrices(nodeComputeFilter(region));
    if (failed(nodeComputeResult)) return nodeComputeResult;
    const nodeSurchargeResult = await fetchRetailPrices(nodeSurchargeFilter(region));
    if (failed(nodeSurchargeResult)) return nodeSurchargeResult;
    const acrResult = await fetchRetailPrices(acrFilter());
    if (failed(acrResult)) return acrResult;

    const items: CostEstimateLineItem[] = [];

    const controlPlane = firstPriced(controlPlaneResult.result);
    if (!controlPlane) {
        return {
            succeeded: false,
            error: l10n.t("Couldn't find AKS Automatic control plane pricing for {0}.", location),
        };
    }
    items.push({
        label: l10n.t("AKS Automatic control plane"),
        monthlyCost: controlPlane.retailPrice * HOURS_PER_MONTH,
        detail: l10n.t("Flat hosted control plane fee at {0}/hour.", formatRate(controlPlane.retailPrice)),
        isApproximate: false,
    });

    const nodeCompute = nodeComputeResult.result.find((item) => item.retailPrice > 0 && isStandardLinuxOnDemand(item));
    if (!nodeCompute) {
        return {
            succeeded: false,
            error: l10n.t("Couldn't find {0} compute pricing for {1}.", REPRESENTATIVE_NODE_SKU, location),
        };
    }
    const nodeCount = BASELINE_VCPUS / REPRESENTATIVE_NODE_VCPUS;
    items.push({
        label: l10n.t("Node compute (estimated)"),
        monthlyCost: nodeCompute.retailPrice * nodeCount * HOURS_PER_MONTH,
        detail: l10n.t(
            "Assumes {0} × {1} at {2}/hour to cover a {3}-vCPU baseline.",
            nodeCount,
            REPRESENTATIVE_NODE_SKU,
            formatRate(nodeCompute.retailPrice),
            BASELINE_VCPUS,
        ),
        isApproximate: true,
    });

    const nodeSurcharge = firstPriced(nodeSurchargeResult.result);
    if (nodeSurcharge) {
        items.push({
            label: l10n.t("AKS Automatic node management"),
            monthlyCost: nodeSurcharge.retailPrice * BASELINE_VCPUS * HOURS_PER_MONTH,
            detail: l10n.t(
                "Automatic management premium at {0}/vCPU-hour across {1} vCPUs.",
                formatRate(nodeSurcharge.retailPrice),
                BASELINE_VCPUS,
            ),
            isApproximate: true,
        });
    }

    const acr = firstPriced(acrResult.result);
    if (!acr) {
        return {
            succeeded: false,
            error: l10n.t("Couldn't find Azure Container Registry Basic pricing."),
        };
    }
    items.push({
        label: l10n.t("Container registry (Basic)"),
        monthlyCost: acr.retailPrice * DAYS_PER_MONTH,
        detail: l10n.t("Azure Container Registry Basic tier at {0}/day.", formatRate(acr.retailPrice)),
        isApproximate: false,
    });

    const monthlyTotal = items.reduce((sum, item) => sum + item.monthlyCost, 0);
    const disclaimers = [
        l10n.t(
            "AKS Automatic auto-selects node sizes for your workload. Node compute is estimated from a representative {0} configuration and will vary with actual usage and autoscaling.",
            REPRESENTATIVE_NODE_SKU,
        ),
        l10n.t("Figures are retail pay-as-you-go rates and exclude taxes, discounts, reservations, and savings plans."),
        l10n.t("Storage, networking, load balancers, and data egress are not included."),
    ];

    return {
        succeeded: true,
        result: {
            location,
            currencyCode: CURRENCY_CODE,
            monthlyTotal,
            isApproximate: true,
            items,
            disclaimers,
        },
    };
}
