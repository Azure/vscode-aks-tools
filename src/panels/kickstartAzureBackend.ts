import { OutputChannel } from "vscode";
import * as l10n from "@vscode/l10n";
import type { Permission } from "@azure/arm-authorization";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getEnvironment } from "../auth/azureAuth";
import { getAuthorizationManagementClient, getResourceManagementClient, listAll } from "../commands/utils/arm";
import { getPortalScopeAccessUrl } from "../commands/utils/env";
import { getAcrRegistry } from "../commands/utils/acrs";
import { getClusters } from "../commands/utils/clusters";
import { acrResourceType } from "../commands/utils/azureResources";
import { parseResource } from "../azure-api-utils";
import { acrPullRoleDefinitionName } from "../webview-contract/webviewDefinitions/attachAcrToCluster";
import { ConnectedAcr, ExistingCluster } from "../webview-contract/webviewDefinitions/kickstartCluster";
import { resolveClusterKubeletPrincipalId } from "./kickstartProvision";
import {
    AUTOMATIC_REQUIRED_PROVIDERS,
    AutomaticSkuQuota,
    AutomaticSkuZones,
    REQUIRED_VCPUS_FOR_AUTOMATIC,
    checkAutomaticSkuQuota,
    checkAutomaticSkuZones,
    checkRegionSupportsAks,
    ensureProvidersRegistered,
    getProviderRegistrationStatus,
    normalizeLocation,
} from "../commands/utils/clusterPreflight";
import { Errorable, failed, getErrorMessage, success } from "../commands/utils/errorable";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { getSubscriptions, SelectionType } from "../commands/utils/subscriptions";
import { getFilteredSubscriptions } from "../commands/utils/config";
import {
    UserSubscriptionRoles,
    findEligiblePimGrants,
    findGrantingAction,
    getEffectivePermissionsAtResourceGroup,
    getEffectivePermissionsAtSubscription,
    getUserSubscriptionRoles,
} from "../commands/utils/roleAssignments";
import {
    CheckRoleAssignmentPermissionsResult,
    checkRoleAssignmentPermissions,
} from "../commands/aksCheckPermissions/checkRoleAssignmentPermissions";
import {
    ACR_PUSH_DATAACTION,
    ACR_TASKS_ACTION,
    AKS_CLUSTER_USER_ACTION,
    AKS_DATAPLANE_WRITE_ACTION,
    checkDeploymentPermissions,
} from "../commands/aksCheckPermissions/checkDeploymentPermissions";
import {
    DeploymentActionResult,
    DeploymentPermissionsSummary,
    PimEligibleGrant,
    RegionQuotaResult,
    ResourceGroup,
    RoleSummary,
    SetupStepStatus,
    Subscription,
} from "../webview-contract/webviewDefinitions/kickstartShared";
import { ActivityReporter, ActivitySink, CancellationToken } from "./kickstartActivity";

// Region capacity-risk tiers for AKS Automatic system-pool availability. Ordering drives which
// region we recommend first: `low` regions have ample open pool capacity, `medium` have shrinking
// headroom, and `high` are capacity-constrained (system pools supportable well below entitlement)
// and are deprioritised. Membership only — no raw capacity numbers are encoded, since those drift.
const REGION_CAPACITY_RISK = {
    low: [
        "newzealandnorth",
        "japanwest",
        "canadacentral",
        "swedencentral",
        "eastasia",
        "centralindia",
        "australiacentral",
        "eastus2",
        "polandcentral",
        "ukwest",
        "westcentralus",
        "koreacentral",
        "switzerlandnorth",
        "italynorth",
    ],
    medium: [
        "southindia",
        "southeastasia",
        "australiaeast",
        "northcentralus",
        "norwayeast",
        "francecentral",
        "centralus",
        "southcentralus",
        "japaneast",
        "canadaeast",
        "brazilsouth",
        "westus2",
        "westus3",
    ],
    high: [
        "eastus",
        "westeurope",
        "northeurope",
        "koreasouth",
        "germanywestcentral",
        "westus",
        "uksouth",
        "eastus3",
        "southcentralus2",
        "southeastus",
        "southwestus",
        "qatarcentral",
    ],
};

const PREFERRED_REGION_ORDER = [...REGION_CAPACITY_RISK.low, ...REGION_CAPACITY_RISK.medium];
const HIGH_RISK_REGIONS = new Set(REGION_CAPACITY_RISK.high);

const MAX_SUGGESTED_REGIONS = 3;

// Regions are probed in priority order through a fixed worker window rather than all at once, so a
// large PREFERRED_REGION_ORDER can't flood ARM with quota+zones calls (each region = 2 calls) and
// trigger throttling. Tuned as a balance between scan latency and ARM pressure.
const SCAN_CONCURRENCY = 5;

/**
 * Runs `worker` over `items` in order with at most `concurrency` in flight, stopping early once
 * `shouldStop(results)` returns true. Because callers pass a priority-ordered list, this scans just
 * enough of the head to satisfy demand instead of the whole list. Results preserve input order for
 * the items that were actually processed. Cancellation is honored between scheduling decisions.
 */
async function scanWithConcurrencyUntil<TIn, TOut>(
    items: TIn[],
    concurrency: number,
    worker: (item: TIn, index: number) => Promise<TOut>,
    shouldStop: (results: TOut[]) => boolean,
    token: CancellationToken,
): Promise<TOut[]> {
    const results: TOut[] = [];
    const indexed = new Map<number, TOut>();
    let nextIndex = 0;
    let stopped = false;
    const inFlight = new Set<Promise<void>>();

    const collect = () => {
        // Drain completed results in input order so early-exit decisions see a stable prefix.
        for (let i = 0; indexed.has(i); i++) {
            results.push(indexed.get(i)!);
            indexed.delete(i);
        }
    };

    while (!stopped && (nextIndex < items.length || inFlight.size > 0)) {
        while (!stopped && inFlight.size < concurrency && nextIndex < items.length) {
            token.throwIfCancelled();
            const index = nextIndex++;
            const task = worker(items[index], index).then((out) => {
                indexed.set(index, out);
            });
            const tracked = task.finally(() => inFlight.delete(tracked));
            inFlight.add(tracked);
        }

        if (inFlight.size > 0) {
            await Promise.race(inFlight);
        }
        collect();
        token.throwIfCancelled();

        if (shouldStop(results)) {
            stopped = true;
        }
    }

    // Let any still-running probes settle so their reported activity entries finish cleanly.
    await Promise.allSettled(inFlight);
    collect();
    return results;
}

function compareRegionsByCapacityRisk(a: string, b: string): number {
    const rank = (region: string): number => {
        const preferred = PREFERRED_REGION_ORDER.indexOf(region);
        if (preferred >= 0) {
            return preferred;
        }
        return HIGH_RISK_REGIONS.has(region) ? PREFERRED_REGION_ORDER.length + 1 : PREFERRED_REGION_ORDER.length;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
}

export interface SubscriptionListResult {
    subscriptions: Subscription[];
    defaultSubscriptionId: string | null;
}

export interface SubscriptionScanResult {
    runId: number;
    recommendedRegion: string | null;
    regionResults: RegionQuotaResult[];
}

async function unwrapErrorable<T>(promise: Promise<Errorable<T>>): Promise<T> {
    const result = await promise;
    if (failed(result)) {
        throw new Error(result.error);
    }
    return result.result;
}

export async function getSubscriptionList(
    sessionProvider: ReadyAzureSessionProvider,
    lastSubscriptionId: string | undefined,
): Promise<Errorable<SubscriptionListResult>> {
    const subscriptions = await getSubscriptions(sessionProvider, SelectionType.AllIfNoFilters);
    if (failed(subscriptions)) {
        return subscriptions;
    }

    const ordered = [...subscriptions.result].sort((a, b) => {
        if (a.subscriptionId === lastSubscriptionId) return -1;
        if (b.subscriptionId === lastSubscriptionId) return 1;
        return a.displayName.localeCompare(b.displayName);
    });

    const subscriptionList: Subscription[] = ordered.map((sub) => ({
        id: sub.subscriptionId,
        name: sub.displayName,
        tenantId: sub.tenantId || "",
    }));

    const filtered = getFilteredSubscriptions();
    const currentlySelectedId =
        filtered.length === 1 && subscriptionList.some((s) => s.id === filtered[0].subscriptionId)
            ? filtered[0].subscriptionId
            : null;

    const defaultSubscriptionId =
        currentlySelectedId ??
        (lastSubscriptionId && subscriptionList.some((s) => s.id === lastSubscriptionId) ? lastSubscriptionId : null) ??
        (subscriptionList.length === 1 ? subscriptionList[0].id : null);

    return success({ subscriptions: subscriptionList, defaultSubscriptionId });
}

export async function getLocationList(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<string[]>> {
    const client = getResourceManagementClient(sessionProvider, subscriptionId);
    const provider = await client.providers.get("Microsoft.ContainerService");
    const resourceTypes = provider.resourceTypes?.filter((t) => t.resourceType === "managedClusters");
    if (!resourceTypes || resourceTypes.length !== 1 || !resourceTypes[0].locations?.length) {
        return {
            succeeded: false,
            error: l10n.t("Could not determine the regions available for AKS in this subscription."),
        };
    }

    return success(resourceTypes[0].locations.map(normalizeLocation).sort(compareRegionsByCapacityRisk));
}

export async function getResourceGroupList(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<ResourceGroup[]>> {
    const groups = await getResourceGroups(sessionProvider, subscriptionId);
    if (failed(groups)) {
        return groups;
    }

    const usableGroups = groups.result
        .filter((g) => !g.name.startsWith("MC_"))
        .map((g) => ({ name: g.name, location: g.location }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return success(usableGroups);
}

export async function getClusterList(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<ExistingCluster[]>> {
    const clusters = await getClusters(sessionProvider, subscriptionId);
    if (failed(clusters)) {
        return clusters;
    }

    const list = clusters.result
        .map((cluster) => ({ name: cluster.name, resourceGroup: cluster.resourceGroup }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return success(list);
}

export async function getConnectedAcrList(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    clusterResourceGroup: string,
    clusterName: string,
): Promise<Errorable<ConnectedAcr[]>> {
    let principalId: string;
    try {
        principalId = await resolveClusterKubeletPrincipalId(
            sessionProvider,
            subscriptionId,
            clusterResourceGroup,
            clusterName,
        );
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }

    const client = getAuthorizationManagementClient(sessionProvider, subscriptionId);
    const assignments = await listAll(
        client.roleAssignments.listForScope(`/subscriptions/${subscriptionId}`, {
            filter: `principalId eq '${principalId}'`,
        }),
    );
    if (failed(assignments)) {
        return assignments;
    }

    const acrScopeFragment = `/providers/${acrResourceType}/`.toLowerCase();
    const acrScopes = [
        ...new Set(
            assignments.result
                .filter((ra) => (ra.roleDefinitionId?.split("/").pop() ?? "") === acrPullRoleDefinitionName)
                .map((ra) => ra.scope)
                .filter((scope): scope is string => Boolean(scope))
                .filter((scope) => scope.toLowerCase().includes(acrScopeFragment)),
        ),
    ];

    const resolved = await Promise.all(
        acrScopes.map(async (scope) => {
            const { resourceGroupName, name } = parseResource(scope);
            if (!resourceGroupName || !name) {
                return null;
            }
            const registry = await getAcrRegistry(sessionProvider, subscriptionId, resourceGroupName, name);
            if (failed(registry)) {
                return null;
            }
            return { name, resourceGroup: resourceGroupName, loginServer: registry.result.loginServer };
        }),
    );

    const acrs = resolved
        .filter((acr): acr is ConnectedAcr => acr !== null)
        .sort((a, b) => a.name.localeCompare(b.name));

    return success(acrs);
}

export async function runSubscriptionScan(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    token: CancellationToken,
): Promise<SubscriptionScanResult> {
    const reporter = new ActivityReporter("subscriptionScan", runId, sink, channel, token);

    const providersStage = reporter.stage("providers", l10n.t("Resource providers"));
    try {
        const status = await providersStage.run(l10n.t("Checking registration"), () =>
            unwrapErrorable(
                getProviderRegistrationStatus(sessionProvider, subscriptionId, AUTOMATIC_REQUIRED_PROVIDERS),
            ),
        );
        if (status.unregistered.length === 0) {
            providersStage.succeed(l10n.t("All required providers are registered."));
        } else {
            providersStage.warn(
                l10n.t(
                    "Not registered yet: {0}. These will be registered automatically before deployment.",
                    status.unregistered.join(", "),
                ),
            );
        }
    } catch (e) {
        token.throwIfCancelled();
        providersStage.warn(l10n.t("Couldn't check provider registration: {0}", getErrorMessage(e)));
    }

    const capacityStage = reporter.stage("quota", l10n.t("Regional capacity"), { collapsible: true });
    // Probe regions in priority order with bounded concurrency, stopping once we have enough
    // recommendable regions. PREFERRED_REGION_ORDER is risk-ranked (best first), so the early-exit
    // still yields the same top suggestions while avoiding a flood of ARM calls across all regions.
    const scannedResults = await scanWithConcurrencyUntil(
        PREFERRED_REGION_ORDER,
        SCAN_CONCURRENCY,
        (location) =>
            capacityStage
                .run(
                    l10n.t("Checking capacity in {0}", location),
                    async () => {
                        const [quota, zones] = await Promise.all([
                            checkAutomaticSkuQuota(
                                sessionProvider,
                                subscriptionId,
                                location,
                                REQUIRED_VCPUS_FOR_AUTOMATIC,
                            ),
                            checkAutomaticSkuZones(sessionProvider, subscriptionId, location),
                        ]);
                        const quotaSummary = summarizeQuota(quota, location);
                        const zoneSummary = summarizeZones(zones, location);
                        // Recommendable only when both quota and the three-zone SKU requirement clear;
                        // zones gate harder than quota, so the zone reason wins when it isn't a pass.
                        const cleared = quotaSummary.status === "succeeded" && zoneSummary.status === "succeeded";
                        const blocking = zoneSummary.status !== "succeeded" ? zoneSummary : quotaSummary;
                        const regionResult: RegionQuotaResult = {
                            location,
                            status: cleared ? "succeeded" : "warning",
                            detail: blocking.detail,
                            hasQuota: quotaSummary.status === "succeeded",
                        };
                        return { regionResult, entryDetail: blocking.entryDetail };
                    },
                    (r) => r.entryDetail,
                )
                .then((r) => r.regionResult),
        // Stop once enough regions have cleared to fill the suggestion slots.
        (results) => results.filter((r) => r.status === "succeeded").length >= MAX_SUGGESTED_REGIONS,
        token,
    );
    token.throwIfCancelled();

    const availableRegions = scannedResults.filter((r) => r.status === "succeeded");
    const recommendedRegion = availableRegions[0]?.location ?? null;
    const suggestedRegions = availableRegions.length > 0 ? availableRegions : scannedResults;
    const regionResults = suggestedRegions.slice(0, MAX_SUGGESTED_REGIONS);

    if (recommendedRegion) {
        capacityStage.succeed(l10n.t("Recommended region: {0}", recommendedRegion));
    } else {
        capacityStage.warn(l10n.t("None of the scanned regions had enough AKS Automatic capacity."));
    }

    return { runId, recommendedRegion, regionResults };
}

export interface PreflightResult {
    canProceed: boolean;
    role: RoleSummary;
    deployment: DeploymentPermissionsSummary;
    readiness: DeploymentPermissionsSummary;
}

export async function runPreflightChecks(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    location: string,
    resourceGroup: { name: string; isNew: boolean },
    runId: number,
    sink: ActivitySink,
    channel: OutputChannel,
    token: CancellationToken,
): Promise<PreflightResult> {
    const reporter = new ActivityReporter("preflight", runId, sink, channel, token);
    let canProceed = true;

    const regionStage = reporter.stage("region", l10n.t("Region supports AKS"));
    try {
        const supported = await regionStage.run(l10n.t("Checking AKS availability in {0}", location), () =>
            unwrapErrorable(checkRegionSupportsAks(sessionProvider, subscriptionId, location)),
        );
        if (supported) {
            regionStage.succeed(l10n.t("AKS is available in {0}.", location));
        } else {
            regionStage.fail(l10n.t("AKS is not available in {0}.", location));
            canProceed = false;
        }
    } catch (e) {
        regionStage.fail(getErrorMessage(e));
        canProceed = false;
    }

    const providersStage = reporter.stage("providers", l10n.t("Required resource providers registered"));
    try {
        const providers = await providersStage.run(l10n.t("Registering required providers"), () =>
            unwrapErrorable(ensureProvidersRegistered(sessionProvider, subscriptionId, AUTOMATIC_REQUIRED_PROVIDERS)),
        );
        if (providers.newlyRegistered.length > 0) {
            providersStage.succeed(l10n.t("Registered: {0}", providers.newlyRegistered.join(", ")));
        } else {
            providersStage.succeed(l10n.t("All required providers were already registered."));
        }
    } catch (e) {
        providersStage.fail(getErrorMessage(e));
        canProceed = false;
    }

    const quotaStage = reporter.stage("quota", l10n.t("Regional vCPU quota available"));
    const quota = await quotaStage.run(
        l10n.t("Checking quota in {0}", location),
        () => checkAutomaticSkuQuota(sessionProvider, subscriptionId, location, REQUIRED_VCPUS_FOR_AUTOMATIC),
        (q) => summarizeQuota(q, location).entryDetail,
    );
    const quotaSummary = summarizeQuota(quota, location);
    if (quotaSummary.status === "succeeded") {
        quotaStage.succeed(quotaSummary.detail);
    } else {
        quotaStage.warn(quotaSummary.detail);
    }

    const zonesStage = reporter.stage("zones", l10n.t("Availability zones for AKS Automatic"));
    const zones = await zonesStage.run(
        l10n.t("Checking availability zones in {0}", location),
        () => checkAutomaticSkuZones(sessionProvider, subscriptionId, location),
        (z) => summarizeZones(z, location).entryDetail,
    );
    const zoneSummary = summarizeZones(zones, location);
    if (zoneSummary.status === "succeeded") {
        zonesStage.succeed(zoneSummary.detail);
    } else if (zoneSummary.status === "failed") {
        zonesStage.fail(zoneSummary.detail);
        canProceed = false;
    } else {
        zonesStage.warn(zoneSummary.detail);
    }

    const role = await runRoleStage(reporter, sessionProvider, subscriptionId, resourceGroup, token);
    const { summary: deployment, perms } = await runProvisioningPermissionsStage(
        reporter,
        sessionProvider,
        subscriptionId,
        resourceGroup,
        token,
    );
    const readiness = runReadinessStage(reporter, perms, role);

    return { canProceed, role, deployment, readiness };
}

async function runRoleStage(
    reporter: ActivityReporter,
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: { name: string; isNew: boolean },
    token: CancellationToken,
): Promise<RoleSummary> {
    const stageLabel = resourceGroup.isNew
        ? l10n.t("Permission to assign roles in subscription")
        : l10n.t("Permission to assign roles in '{0}'", resourceGroup.name);
    const stage = reporter.stage("role", stageLabel);
    const entryLabel = resourceGroup.isNew
        ? l10n.t("Probing subscription-scope permissions")
        : l10n.t("Probing resource-group permissions");

    let role: RoleSummary;
    try {
        if (resourceGroup.isNew) {
            // New RG inherits sub-scope perms; the RG-scoped command can't probe a non-existent RG,
            // so fall back to the sub-scope helper here. PIM enrichment below uses sub scope too.
            const roleResult = await stage.run(entryLabel, () =>
                getUserSubscriptionRoles(sessionProvider, subscriptionId),
            );
            role = summarizeSubscriptionRole(roleResult);
        } else {
            // Delegates to the shared `aks.checkRoleAssignmentPermissions` command (silent mode) so
            // panel + palette + agent surfaces all use one probe + PIM-lookup pipeline.
            const cmdResult = await stage.run(entryLabel, () =>
                checkRoleAssignmentPermissions(undefined, {
                    subscriptionId,
                    resourceGroup: resourceGroup.name,
                    silent: true,
                }),
            );
            role = summarizeRoleCommandResult(cmdResult, resourceGroup.name);
        }
    } catch (e) {
        token.throwIfCancelled();
        role = summarizeSubscriptionRole({ succeeded: false, error: getErrorMessage(e) });
    }

    if (resourceGroup.isNew && !(role.canAssignRolesKnown && role.canAssignRoles)) {
        role.eligiblePimGrants = await findSubscriptionPimGrants(sessionProvider, subscriptionId);
    }

    if (role.canAssignRolesKnown && role.canAssignRoles) {
        stage.succeed(role.detail);
    } else {
        stage.warn(role.detail);

        const currentRoles =
            role.roleNames.length > 0
                ? role.roleNames.join(", ")
                : l10n.t("No active role at this scope grants role-assignment write");
        stage.addEntry({
            action: l10n.t("Current role(s) for role-assignment write"),
            status: "warning",
            detail: currentRoles,
        });
        stage.addEntry({
            action: l10n.t("Role needed"),
            status: "warning",
            detail: l10n.t("Owner or User Access Administrator"),
        });

        if (!resourceGroup.isNew) {
            role.permissionActionUrl = getPortalScopeAccessUrl(
                getEnvironment(),
                sessionProvider.selectedTenant.id,
                `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup.name}`,
            );
        }

        // Display eligible PIM roles as informational activity entries.
        if (role.eligiblePimGrants && role.eligiblePimGrants.length > 0) {
            for (const grant of role.eligiblePimGrants) {
                stage.addEntry({
                    action: l10n.t(
                        "Eligible PIM role: {0} ({1})",
                        grant.roleName,
                        grant.scopeDisplayName ?? grant.roleName,
                    ),
                    status: "warning",
                    detail: l10n.t("Activate this role in PIM, then re-check access."),
                });
            }
        } else if (resourceGroup.isNew) {
            role.actionBanner = {
                message: l10n.t(
                    "Your subscription role can't assign roles. After the resource group is created, deployment pauses until you can assign roles there.",
                ),
                actionText: l10n.t("Review role-assignment options"),
                nextSteps: [
                    l10n.t("Activate an eligible PIM role after the resource group is created, then re-check."),
                    l10n.t(
                        "Or ask an admin for 'Azure Kubernetes Service RBAC Cluster Admin' on just the new cluster.",
                    ),
                    l10n.t("Or ask an admin for 'Owner' or 'User Access Administrator' on the resource group."),
                ],
            };
            stage.addEntry({
                action: l10n.t("Role-assignment permission is re-checked after the resource group is created"),
                status: "warning",
                detail: l10n.t("If you still can't assign roles, deployment pauses until access is granted."),
            });
        } else {
            const rgScope = `resource group '${resourceGroup.name}'`;
            role.actionBanner = {
                message: l10n.t(
                    "You don't have permission to assign roles in {0}, and no PIM-eligible roles are available. " +
                        "A subscription owner or admin must grant you the 'Owner' or 'User Access Administrator' role.",
                    rgScope,
                ),
                actionText: l10n.t("Request access from your admin"),
                nextSteps: [
                    l10n.t(
                        "Contact your Azure subscription admin to request the 'Owner' or 'User Access Administrator' role",
                    ),
                    l10n.t("Or ask them to run this deployment on your behalf"),
                    l10n.t(
                        "Or activate an eligible PIM role if available (check Privileged Identity Management in Azure Portal)",
                    ),
                ],
            };
            stage.addEntry({
                action: l10n.t("Action required"),
                status: "warning",
                detail: l10n.t("Contact your admin to request role assignment permissions"),
            });
        }
    }
    return role;
}

async function runProvisioningPermissionsStage(
    reporter: ActivityReporter,
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: { name: string; isNew: boolean },
    token: CancellationToken,
): Promise<{ summary: DeploymentPermissionsSummary; perms: Errorable<Permission[]> }> {
    const stageLabel = l10n.t("Provisioning permissions");
    const stage = reporter.stage("deployment", stageLabel);
    const entryLabel = resourceGroup.isNew
        ? l10n.t("Probing subscription-scope permissions")
        : l10n.t("Probing resource-group permissions");

    const probes: { label: string; action: string; kind: "action" | "dataAction" }[] = [
        {
            label: l10n.t("Create AKS cluster"),
            action: "Microsoft.ContainerService/managedClusters/write",
            kind: "action",
        },
        {
            label: l10n.t("Create container registry"),
            action: "Microsoft.ContainerRegistry/registries/write",
            kind: "action",
        },
    ];

    const authClient = getAuthorizationManagementClient(sessionProvider, subscriptionId);
    let perms: Errorable<Permission[]>;
    try {
        perms = await stage.run(entryLabel, () =>
            resourceGroup.isNew
                ? getEffectivePermissionsAtSubscription(sessionProvider, authClient, subscriptionId)
                : getEffectivePermissionsAtResourceGroup(authClient, resourceGroup.name),
        );
    } catch (e) {
        token.throwIfCancelled();
        const error = getErrorMessage(e);
        const summary: DeploymentPermissionsSummary = {
            known: false,
            allGranted: false,
            actions: [],
            detail: l10n.t("Couldn't probe deployment permissions: {0}", error),
        };
        stage.warn(summary.detail);
        return { summary, perms: { succeeded: false, error } };
    }

    if (failed(perms)) {
        const summary: DeploymentPermissionsSummary = {
            known: false,
            allGranted: false,
            actions: [],
            detail: l10n.t("Couldn't read effective permissions: {0}", perms.error),
        };
        stage.warn(summary.detail);
        return { summary, perms };
    }

    const effective = perms.result;
    const actions: DeploymentActionResult[] = probes.map((p) => ({
        label: p.label,
        action: p.action,
        granted: findGrantingAction(effective, p.action, p.kind).granted,
    }));
    const allGranted = actions.every((a) => a.granted);
    const missing = actions.filter((a) => !a.granted).map((a) => a.label);
    const detail = allGranted
        ? l10n.t("You can create the cluster and registry.")
        : l10n.t(
              "You may not be able to create: {0}. Provisioning will fail unless an Owner or Contributor on this scope runs it.",
              missing.join(", "),
          );

    const summary: DeploymentPermissionsSummary = { known: true, allGranted, actions, detail };
    if (allGranted) {
        stage.succeed(detail);
    } else {
        stage.warn(detail);
    }
    return { summary, perms };
}

function runReadinessStage(
    reporter: ActivityReporter,
    perms: Errorable<Permission[]>,
    role: RoleSummary,
): DeploymentPermissionsSummary {
    const stage = reporter.stage("readiness", l10n.t("Deployment readiness"));

    const aksGranted = role.canAssignRolesKnown && role.canAssignRoles;
    const aksDetail = aksGranted
        ? l10n.t("Granted automatically while the cluster is provisioned.")
        : l10n.t("Depends on the role-assignment permission flagged above.");
    const aksActions: DeploymentActionResult[] = [
        {
            label: l10n.t("Download cluster kubeconfig"),
            action: AKS_CLUSTER_USER_ACTION,
            granted: aksGranted,
            detail: aksDetail,
        },
        {
            label: l10n.t("Deploy workloads to the cluster"),
            action: AKS_DATAPLANE_WRITE_ACTION,
            granted: aksGranted,
            detail: aksDetail,
        },
    ];

    if (failed(perms)) {
        const summary: DeploymentPermissionsSummary = {
            known: false,
            allGranted: false,
            actions: aksActions,
            detail: l10n.t("Couldn't read effective permissions to predict registry access: {0}", perms.error),
        };
        stage.warn(summary.detail);
        return summary;
    }

    const effective = perms.result;
    const acrActions: DeploymentActionResult[] = [
        {
            label: l10n.t("Push images to the new registry"),
            action: ACR_PUSH_DATAACTION,
            granted: findGrantingAction(effective, ACR_PUSH_DATAACTION, "dataAction").granted,
        },
        {
            label: l10n.t("Run server-side ACR builds (az acr build)"),
            action: ACR_TASKS_ACTION,
            granted: findGrantingAction(effective, ACR_TASKS_ACTION, "action").granted,
        },
    ];

    const actions = [...aksActions, ...acrActions];
    const allGranted = actions.every((a) => a.granted);
    const missing = actions.filter((a) => !a.granted).map((a) => a.label);
    const detail = allGranted
        ? l10n.t("After provisioning you'll be able to deploy workloads and push images.")
        : l10n.t("After provisioning you may still need: {0}.", missing.join(", "));

    const summary: DeploymentPermissionsSummary = { known: true, allGranted, actions, detail };
    if (allGranted) {
        stage.succeed(detail);
    } else {
        stage.warn(detail);
    }
    return summary;
}

export async function getExistingClusterReadiness(
    subscriptionId: string,
    clusterResourceGroup: string,
    clusterName: string,
    acrName: string | undefined,
    acrResourceGroup: string | undefined,
): Promise<DeploymentPermissionsSummary> {
    try {
        const result = await checkDeploymentPermissions(undefined, {
            subscriptionId,
            resourceGroup: clusterResourceGroup,
            clusterName,
            acrName,
            acrResourceGroup,
            probeScope: "user",
            silent: true,
        });
        if (result.error || !result.probes) {
            return {
                known: false,
                allGranted: false,
                actions: [],
                detail: result.error
                    ? l10n.t("Couldn't check deployment readiness: {0}", result.error)
                    : l10n.t("Couldn't check deployment readiness."),
            };
        }
        const actions: DeploymentActionResult[] = result.probes.map((probe) => ({
            label: probe.label,
            action: probeActionId(probe.id),
            granted: probe.status === "pass",
            detail: probe.status === "pass" ? undefined : probe.reason,
        }));
        const allGranted = actions.every((a) => a.granted);
        const missing = actions.filter((a) => !a.granted).map((a) => a.label);
        const detail = allGranted
            ? acrName
                ? l10n.t("You can deploy workloads and push images to this cluster.")
                : l10n.t("You can deploy workloads to this cluster.")
            : l10n.t("You may not be able to: {0}.", missing.join(", "));
        return { known: true, allGranted, actions, detail };
    } catch (e) {
        return {
            known: false,
            allGranted: false,
            actions: [],
            detail: l10n.t("Couldn't check deployment readiness: {0}", getErrorMessage(e)),
        };
    }
}

function probeActionId(id: string): string {
    switch (id) {
        case "cluster-user":
            return AKS_CLUSTER_USER_ACTION;
        case "aks-dataplane-write":
            return AKS_DATAPLANE_WRITE_ACTION;
        case "acr-push":
            return ACR_PUSH_DATAACTION;
        case "acr-tasks":
            return ACR_TASKS_ACTION;
        default:
            return id;
    }
}

function summarizeSubscriptionRole(roleResult: Errorable<UserSubscriptionRoles>): RoleSummary {
    if (failed(roleResult)) {
        return {
            roleNames: [],
            canAssignRoles: false,
            canAssignRolesKnown: false,
            detail: l10n.t("Couldn't read your role assignments: {0}", roleResult.error),
        };
    }
    const { roleNames, canAssignRoles } = roleResult.result;
    if (roleNames.length === 0) {
        return {
            roleNames,
            canAssignRoles: false,
            canAssignRolesKnown: true,
            detail: l10n.t("No role assignments found on this subscription."),
        };
    }

    const detail = canAssignRoles
        ? l10n.t("You have: {0}.", roleNames.join(", "))
        : l10n.t("Your role ({0}) can't assign roles in this subscription.", roleNames.join(", "));

    return { roleNames, canAssignRoles, canAssignRolesKnown: true, detail };
}

async function findSubscriptionPimGrants(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<PimEligibleGrant[] | undefined> {
    try {
        const client = getAuthorizationManagementClient(sessionProvider, subscriptionId);
        const eligible = await findEligiblePimGrants(client, `/subscriptions/${subscriptionId}`);
        if (failed(eligible) || eligible.result.length === 0) {
            return undefined;
        }
        return eligible.result.map((g) => ({
            roleName: g.roleName,
            scopeId: g.scopeId,
            scopeDisplayName: g.scopeDisplayName ?? g.scopeId,
        }));
    } catch {
        return undefined;
    }
}

function summarizeRoleCommandResult(
    result: CheckRoleAssignmentPermissionsResult,
    resourceGroupName: string,
): RoleSummary {
    if (result.error) {
        return {
            roleNames: [],
            canAssignRoles: false,
            canAssignRolesKnown: false,
            detail: l10n.t("Couldn't read effective permissions on '{0}': {1}", resourceGroupName, result.error),
        };
    }
    const canAssignRoles = result.canCreate === true;
    const roleNames = result.activeRoleNames ?? [l10n.t("Active role names unavailable for this scope")];
    const pimGrants: PimEligibleGrant[] = (result.eligiblePimRoles ?? []).map((g) => ({
        roleName: g.roleName,
        scopeId: g.scopeId,
        scopeDisplayName: g.scopeDisplayName ?? g.scopeId,
    }));
    const detail = canAssignRoles
        ? l10n.t("You can create role assignments in '{0}'.", resourceGroupName)
        : l10n.t("You can't assign roles in '{0}'.", resourceGroupName);
    return {
        roleNames,
        canAssignRoles,
        canAssignRolesKnown: true,
        detail,
        eligiblePimGrants: pimGrants.length > 0 ? pimGrants : undefined,
    };
}

function summarizeQuota(
    quota: Errorable<AutomaticSkuQuota>,
    location: string,
): { status: SetupStepStatus; detail: string; entryDetail: string } {
    if (failed(quota)) {
        return {
            status: "warning",
            detail: l10n.t("Couldn't read the AKS Automatic vCPU quota: {0}", quota.error),
            entryDetail: l10n.t("quota unavailable"),
        };
    }

    const { available, limit } = quota.result.cores;
    if (!quota.result.sufficient) {
        return {
            status: "warning",
            detail: l10n.t(
                "Only {0} of {1} regional vCPUs are available, but AKS Automatic needs at least {2}. You may need to request a quota increase.",
                available,
                limit,
                REQUIRED_VCPUS_FOR_AUTOMATIC,
            ),
            entryDetail: l10n.t("{0} of {1} vCPUs free, {2} needed", available, limit, REQUIRED_VCPUS_FOR_AUTOMATIC),
        };
    }

    return {
        status: "succeeded",
        detail: l10n.t("{0} regional vCPUs available in {1} for AKS Automatic.", available, location),
        entryDetail: l10n.t("{0} of {1} vCPUs free", available, limit),
    };
}

function summarizeZones(
    zones: Errorable<AutomaticSkuZones>,
    location: string,
): { status: SetupStepStatus; detail: string; entryDetail: string } {
    if (failed(zones)) {
        // A transient probe failure shouldn't condemn the region: warn so the user can retry rather
        // than being told a usable region is unusable. ARM still rejects a real shortfall on deploy.
        return {
            status: "warning",
            detail: l10n.t("Couldn't verify availability-zone support for AKS Automatic: {0}", zones.error),
            entryDetail: l10n.t("zone support unverified"),
        };
    }

    const { offered, bestUsableZoneCount, blockedForSubscription, requiredZoneCount, sufficient } = zones.result;
    if (sufficient) {
        return {
            status: "succeeded",
            detail: l10n.t(
                "AKS Automatic VM sizes are available across at least {0} availability zones in {1}.",
                requiredZoneCount,
                location,
            ),
            entryDetail: l10n.t("{0}+ zones available", requiredZoneCount),
        };
    }

    if (offered.length === 0) {
        return {
            status: "failed",
            detail: l10n.t(
                "{0} doesn't offer any of the VM sizes AKS Automatic needs for its system node pool.",
                location,
            ),
            entryDetail: l10n.t("no AKS Automatic VM sizes"),
        };
    }

    // The SKUs exist in the region but aren't enabled for this subscription (NotAvailableForSubscription).
    // That's an enablement/allocation issue, not a regional capacity gap, so guide toward requesting access.
    if (blockedForSubscription) {
        return {
            status: "failed",
            detail: l10n.t(
                "The VM sizes AKS Automatic needs aren't enabled for your subscription in {0} (they offer only {1} of the {2} required availability zones). Request access to these VM sizes for your subscription, or choose another region.",
                location,
                bestUsableZoneCount,
                requiredZoneCount,
            ),
            entryDetail: l10n.t("VM sizes not enabled for subscription"),
        };
    }

    return {
        status: "failed",
        detail: l10n.t(
            "The VM sizes AKS Automatic needs offer only {0} of the {1} availability zones it requires in {2}. Choose another region.",
            bestUsableZoneCount,
            requiredZoneCount,
            location,
        ),
        entryDetail: l10n.t("{0} of {1} zones available", bestUsableZoneCount, requiredZoneCount),
    };
}
