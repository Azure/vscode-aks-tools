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
