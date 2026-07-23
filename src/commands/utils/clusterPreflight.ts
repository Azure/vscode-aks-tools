import { ReadyAzureSessionProvider } from "../../auth/types";
import { getComputeManagementClient, getResourceManagementClient } from "./arm";
import { Errorable, getErrorMessage } from "./errorable";

// Documented AKS Automatic recommended minimum for total regional vCPUs.
export const REQUIRED_VCPUS_FOR_AUTOMATIC = 16;

// Compute "usages" family keys for the x64 general-purpose D-series SKUs that AKS Automatic node
// auto-provisioning lands on by default. Casing is INCONSISTENT across generations and matches the
// usages API verbatim — it must NOT be normalized or the `===` lookup silently misses. Verified
// against Azure CLI `az vm list-usage`, Karpenter known_skus.yaml, and the k8s cluster-autoscaler.
// Arm (Dp*) and confidential (DC*) families are intentionally excluded so a region with only those
// available doesn't falsely pass the default x64 path.
export const AKS_AUTOMATIC_CANDIDATE_FAMILIES = [
    // v2: DSv2 SKUs (e.g. DS3_v2) are part of AKS Automatic's fallback set in older regions.
    "standardDSv2Family",
    // v4 / v5: lowercase "standard", uppercase sub-family
    "standardDv4Family",
    "standardDSv4Family",
    "standardDDv4Family",
    "standardDDSv4Family",
    "standardDAv4Family",
    "standardDASv4Family",
    "standardDv5Family",
    "standardDSv5Family",
    "standardDDv5Family",
    "standardDDSv5Family",
    "standardDASv5Family",
    "standardDADSv5Family",
    "standardDLSv5Family",
    "standardDLDSv5Family",
    // v6 Intel: uppercase "Standard", lowercase sub-family
    "StandardDsv6Family",
    "StandardDdsv6Family",
    "StandardDlsv6Family",
    "StandardDldsv6Family",
    // v6 AMD: lowercase "standard", lowercase sub-family
    "standardDav6Family",
    "standardDadv6Family",
    "standardDalv6Family",
    "standardDaldv6Family",
    // v7 AMD: uppercase "Standard", lowercase sub-family
    "StandardDasv7Family",
    "StandardDadsv7Family",
    "StandardDalsv7Family",
    "StandardDaldsv7Family",
];

// The fixed set of 4-vCPU x64 D-series SKUs (each with a local temp disk for the ephemeral OS disk
// the system pool needs) that the AKS RP picks from for an AKS Automatic system node pool. The
// control plane requires the chosen SKU to be available in at least three availability zones; when
// no candidate clears that bar for the subscription, creation fails with "could not find a suitable
// VM size ... may not support three availability zones". Unlike the quota families above, these are
// exact SKU names matched against resourceSkus (case-insensitively) — a broader family match would
// admit v7 SKUs the RP does NOT use and falsely pass regions. Keep in sync with the AKS troubleshoot
// guide: https://learn.microsoft.com/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-automatic-troubleshoot
// Last verified: 2026-03-19.
export const AKS_AUTOMATIC_SYSTEM_POOL_SKUS = [
    "Standard_D4lds_v5",
    "Standard_D4ads_v5",
    "Standard_D4ds_v5",
    "Standard_D4d_v5",
    "Standard_D4d_v4",
    "Standard_DS3_v2",
    "Standard_DS12_v2",
    "Standard_D4alds_v6",
    "Standard_D4lds_v6",
    "Standard_D4alds_v5",
];

export const REQUIRED_AVAILABILITY_ZONES_FOR_AUTOMATIC = 3;

export const AUTOMATIC_REQUIRED_PROVIDERS = [
    "Microsoft.ContainerService",
    "Microsoft.Compute",
    "Microsoft.PolicyInsights",
    "Microsoft.ContainerRegistry",
    "Microsoft.Network",
    "Microsoft.ManagedIdentity",
];

export interface ProviderRegistrationResult {
    alreadyRegistered: string[];
    newlyRegistered: string[];
}

export interface ProviderRegistrationStatus {
    registered: string[];
    unregistered: string[];
}

export interface VCpuQuota {
    limit: number;
    currentValue: number;
    available: number;
    sufficient: boolean;
}

export interface FamilyQuota extends VCpuQuota {
    name: string;
}

export interface AutomaticSkuQuota {
    cores: VCpuQuota;
    families: FamilyQuota[];
    sufficient: boolean;
}

export interface SkuZoneAvailability {
    name: string;
    regionZones: string[];
    usableZones: string[];
    sufficient: boolean;
    /**
     * True when this SKU is blocked by a `NotAvailableForSubscription` restriction (the family isn't
     * enabled for the subscription in this region/zone) rather than a transient capacity/zone
     * shortfall. Distinguishes "request SKU enablement" from "pick another region".
     */
    notAvailableForSubscription: boolean;
}

export interface AutomaticSkuZones {
    requiredZoneCount: number;
    offered: SkuZoneAvailability[];
    /**
     * The largest number of usable availability zones any single offered SKU provides. This is the
     * value that actually gates AKS Automatic (it needs one SKU with enough zones), unlike a union
     * of restricted zones across SKUs, which overstates the restriction.
     */
    bestUsableZoneCount: number;
    /**
     * True when every offered SKU is blocked specifically by `NotAvailableForSubscription`, i.e. the
     * region has the SKUs but they aren't enabled for this subscription. Drives a clearer message.
     */
    blockedForSubscription: boolean;
    sufficient: boolean;
}

// Azure ARM provider metadata reports region *display names* ("East US"), while the rest of the
// deployment flow (the quota API, az CLI, and the recommended-region presets) uses normalized
// region *codes* ("eastus"). Collapsing to the code form lets us compare and pass regions
// consistently regardless of which form a value started in.
export function normalizeLocation(location: string): string {
    return location.toLowerCase().replace(/\s+/g, "");
}

export async function checkRegionSupportsAks(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
): Promise<Errorable<boolean>> {
    try {
        const client = getResourceManagementClient(sessionProvider, subscriptionId);
        const provider = await client.providers.get("Microsoft.ContainerService");
        const managedClusters = provider.resourceTypes?.find((t) => t.resourceType === "managedClusters");
        const locations = (managedClusters?.locations ?? []).map(normalizeLocation);
        return { succeeded: true, result: locations.includes(normalizeLocation(location)) };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function ensureProvidersRegistered(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    namespaces: string[],
): Promise<Errorable<ProviderRegistrationResult>> {
    const client = getResourceManagementClient(sessionProvider, subscriptionId);
    const alreadyRegistered: string[] = [];
    const newlyRegistered: string[] = [];
    try {
        for (const namespace of namespaces) {
            const provider = await client.providers.get(namespace);
            if (provider.registrationState === "Registered") {
                alreadyRegistered.push(namespace);
                continue;
            }

            await client.providers.register(namespace);
            const registered = await pollUntilRegistered(client, namespace);
            if (!registered) {
                return {
                    succeeded: false,
                    error: `Timed out waiting for resource provider '${namespace}' to finish registering.`,
                };
            }
            newlyRegistered.push(namespace);
        }
        return { succeeded: true, result: { alreadyRegistered, newlyRegistered } };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

// Read-only counterpart to ensureProvidersRegistered: reports which providers are already
// registered without mutating the subscription. Used by the advisory subscription scan so that
// merely selecting a subscription never triggers a registration side effect.
export async function getProviderRegistrationStatus(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    namespaces: string[],
): Promise<Errorable<ProviderRegistrationStatus>> {
    const client = getResourceManagementClient(sessionProvider, subscriptionId);
    const registered: string[] = [];
    const unregistered: string[] = [];
    try {
        for (const namespace of namespaces) {
            const provider = await client.providers.get(namespace);
            if (provider.registrationState === "Registered") {
                registered.push(namespace);
            } else {
                unregistered.push(namespace);
            }
        }
        return { succeeded: true, result: { registered, unregistered } };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function checkAutomaticSkuQuota(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
    requiredVCpus: number,
): Promise<Errorable<AutomaticSkuQuota>> {
    try {
        const client = getComputeManagementClient(sessionProvider, subscriptionId);
        const usages = client.usage.list(location);
        const candidateFamilies = new Set(AKS_AUTOMATIC_CANDIDATE_FAMILIES);
        let cores: VCpuQuota | null = null;
        const families: FamilyQuota[] = [];

        for await (const usage of usages) {
            const name = usage.name?.value;
            if (!name) {
                continue;
            }
            const limit = usage.limit ?? 0;
            const currentValue = usage.currentValue ?? 0;
            const quota = {
                limit,
                currentValue,
                available: limit - currentValue,
                sufficient: currentValue + requiredVCpus <= limit,
            };
            // "cores" is the Total Regional vCPUs ceiling that gates every VM-backed node pool.
            if (name === "cores") {
                cores = quota;
            } else if (candidateFamilies.has(name)) {
                families.push({ name, ...quota });
            }
        }

        if (cores === null) {
            return {
                succeeded: false,
                error: `Could not find the total regional vCPU quota ('cores') for ${location}.`,
            };
        }

        // AKS uses whichever candidate family has room (any sufficient family passes); if the region
        // reports none of our known families, fall back to the regional cores ceiling.
        const familySufficient = families.length === 0 || families.some((f) => f.sufficient);
        return {
            succeeded: true,
            result: { cores, families, sufficient: cores.sufficient && familySufficient },
        };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function checkAutomaticSkuZones(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
    requiredZoneCount: number = REQUIRED_AVAILABILITY_ZONES_FOR_AUTOMATIC,
): Promise<Errorable<AutomaticSkuZones>> {
    try {
        const client = getComputeManagementClient(sessionProvider, subscriptionId);
        const normalizedLocation = normalizeLocation(location);
        const candidateSkus = new Map(AKS_AUTOMATIC_SYSTEM_POOL_SKUS.map((name) => [name.toLowerCase(), name]));

        const skus = client.resourceSkus.list({ filter: `location eq '${location}'` });
        const offered: SkuZoneAvailability[] = [];

        for await (const sku of skus) {
            if (sku.resourceType !== "virtualMachines" || !sku.name) {
                continue;
            }
            const canonicalName = candidateSkus.get(sku.name.toLowerCase());
            if (!canonicalName) {
                continue;
            }

            const locationInfo = (sku.locationInfo ?? []).find(
                (info) => normalizeLocation(info.location ?? "") === normalizedLocation,
            );
            const regionZones = sortZones(locationInfo?.zones ?? []);

            // A "Location" restriction blocks the SKU across the whole region for this subscription;
            // a "Zone" restriction blocks specific zones. Subtract both from the offered zones. Track
            // whether the blocking reason is subscription enablement (NotAvailableForSubscription) vs
            // a capacity/region shortfall, so we can give the right guidance.
            let locationBlocked = false;
            let notAvailableForSubscription = false;
            const blockedZones = new Set<string>();
            for (const restriction of sku.restrictions ?? []) {
                if (!restrictionAppliesToLocation(restriction, normalizedLocation)) {
                    continue;
                }
                if (restriction.reasonCode === "NotAvailableForSubscription") {
                    notAvailableForSubscription = true;
                }
                if (restriction.type === "Location") {
                    locationBlocked = true;
                } else if (restriction.type === "Zone") {
                    for (const zone of restriction.restrictionInfo?.zones ?? []) {
                        blockedZones.add(zone);
                    }
                }
            }

            const usableZones = locationBlocked ? [] : regionZones.filter((zone) => !blockedZones.has(zone));

            offered.push({
                name: canonicalName,
                regionZones,
                usableZones,
                sufficient: usableZones.length >= requiredZoneCount,
                // Only meaningful when the SKU is actually short of usable zones.
                notAvailableForSubscription: notAvailableForSubscription && usableZones.length < requiredZoneCount,
            });
        }

        const bestUsableZoneCount = offered.reduce((max, sku) => Math.max(max, sku.usableZones.length), 0);
        const shortfallSkus = offered.filter((sku) => !sku.sufficient);
        const blockedForSubscription =
            shortfallSkus.length > 0 && shortfallSkus.every((sku) => sku.notAvailableForSubscription);

        return {
            succeeded: true,
            result: {
                requiredZoneCount,
                offered,
                bestUsableZoneCount,
                blockedForSubscription,
                sufficient: offered.some((sku) => sku.sufficient),
            },
        };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

function sortZones(zones: string[]): string[] {
    return [...new Set(zones)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// A restriction is scoped to locations via restrictionInfo.locations (preferred) or the legacy
// `values` array; when neither names a location it applies region-wide. Normalized so ARM display
// names and region codes compare equal.
function restrictionAppliesToLocation(
    restriction: { values?: string[]; restrictionInfo?: { locations?: string[] } },
    normalizedLocation: string,
): boolean {
    const scopedLocations = [...(restriction.restrictionInfo?.locations ?? []), ...(restriction.values ?? [])].map(
        normalizeLocation,
    );
    return scopedLocations.length === 0 || scopedLocations.includes(normalizedLocation);
}

async function pollUntilRegistered(
    client: ReturnType<typeof getResourceManagementClient>,
    namespace: string,
    timeoutMs = 120000,
    intervalMs = 3000,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await delay(intervalMs);
        const provider = await client.providers.get(namespace);
        if (provider.registrationState === "Registered") {
            return true;
        }
    }
    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
