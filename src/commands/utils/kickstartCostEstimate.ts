import * as l10n from "@vscode/l10n";
import { CostEstimate, CostEstimateLineItem } from "../../webview-contract/webviewDefinitions/kickstartCluster";
import { normalizeLocation } from "./clusterPreflight";
import { Errorable, failed } from "./errorable";
import { RetailPriceItem, fetchRetailPrices } from "./retailPrices";

const HOURS_PER_MONTH = 730;
const DAYS_PER_MONTH = 365 / 12;
const CURRENCY_CODE = "USD";

function controlPlaneFilter(region: string): string {
    return `serviceName eq 'Azure Kubernetes Service' and armRegionName eq '${region}' and skuName eq 'Automatic' and meterName eq 'Automatic Hosted Control Plane'`;
}

function acrFilter(): string {
    return `serviceName eq 'Container Registry' and skuName eq 'Basic' and meterName eq 'Basic Registry Unit'`;
}

function firstPriced(items: RetailPriceItem[]): RetailPriceItem | undefined {
    return items.find((item) => item.retailPrice > 0);
}

function formatRate(value: number): string {
    return `$${Number(value.toFixed(4))}`;
}

export async function estimateClusterMonthlyCost(location: string): Promise<Errorable<CostEstimate>> {
    const region = normalizeLocation(location);

    const controlPlaneResult = await fetchRetailPrices(controlPlaneFilter(region));
    if (failed(controlPlaneResult)) return controlPlaneResult;
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
            "Base cost covers the AKS Automatic control plane and container registry only. Node compute is auto-provisioned by AKS Automatic based on your workload and is not included.",
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
            isApproximate: false,
            items,
            disclaimers,
        },
    };
}
