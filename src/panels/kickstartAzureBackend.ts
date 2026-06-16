import { OutputChannel } from "vscode";
import * as l10n from "@vscode/l10n";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAuthorizationManagementClient, getResourceManagementClient, listAll } from "../commands/utils/arm";
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
    REQUIRED_VCPUS_FOR_AUTOMATIC,
    checkAutomaticSkuQuota,
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

const SCAN_REGIONS = ["eastus", "eastus2", "westus2", "westeurope"];

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

    return success(resourceTypes[0].locations.map(normalizeLocation));
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

    const quotaStage = reporter.stage("quota", l10n.t("Regional quota"));
    const regionResults = await Promise.all(
        SCAN_REGIONS.map((location) =>
            quotaStage
                .run(
                    l10n.t("Checking quota in {0}", location),
                    async () => {
                        const quota = await checkAutomaticSkuQuota(
                            sessionProvider,
                            subscriptionId,
                            location,
                            REQUIRED_VCPUS_FOR_AUTOMATIC,
                        );
                        const { status, detail, entryDetail } = summarizeQuota(quota, location);
                        const regionResult: RegionQuotaResult = {
                            location,
                            status,
                            detail,
                            hasQuota: status === "succeeded",
                        };
                        return { regionResult, entryDetail };
                    },
                    (r) => r.entryDetail,
                )
                .then((r) => r.regionResult),
        ),
    );
    token.throwIfCancelled();

    const recommendedRegion = SCAN_REGIONS.find((r) => regionResults.find((x) => x.location === r)?.hasQuota) ?? null;
    if (recommendedRegion) {
        quotaStage.succeed(l10n.t("Recommended region: {0}", recommendedRegion));
    } else {
        quotaStage.warn(l10n.t("None of the scanned regions had enough AKS Automatic quota."));
    }

    return { runId, recommendedRegion, regionResults };
}

export interface PreflightResult {
    canProceed: boolean;
    role: RoleSummary;
    deployment: DeploymentPermissionsSummary;
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

    const role = await runRoleStage(reporter, sessionProvider, subscriptionId, resourceGroup, token);
    const deployment = await runDeploymentPermissionsStage(
        reporter,
        sessionProvider,
        subscriptionId,
        resourceGroup,
        token,
    );

    return { canProceed, role, deployment };
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

    // Shared command now always returns complete PIM grants (or failure reason),
    // so no fallback enrichment needed.

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
                    detail: l10n.t("Activate this role in PIM, then re-run the preflight check."),
                });
            }
        } else {
            // No PIM roles available — add actionable warning banner with next steps
            const rgScope = resourceGroup.isNew
                ? `subscription '${subscriptionId}'`
                : `resource group '${resourceGroup.name}'`;
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

async function runDeploymentPermissionsStage(
    reporter: ActivityReporter,
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
    resourceGroup: { name: string; isNew: boolean },
    token: CancellationToken,
): Promise<DeploymentPermissionsSummary> {
    const stageLabel = resourceGroup.isNew
        ? l10n.t("Permission to create cluster and registry")
        : l10n.t("Permission to create cluster and registry in '{0}'", resourceGroup.name);
    const stage = reporter.stage("deployment", stageLabel);
    const entryLabel = resourceGroup.isNew
        ? l10n.t("Probing subscription-scope permissions")
        : l10n.t("Probing resource-group permissions");

    // Preflight focuses only on control-plane create permissions. Runtime deployment permissions
    // (kubeconfig/data-plane/ACR push-pull) are verified after provisioning begins in the
    // provisioning flow's verification stage.
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
    try {
        const permsResult = await stage.run(entryLabel, () =>
            resourceGroup.isNew
                ? getEffectivePermissionsAtSubscription(sessionProvider, authClient, subscriptionId)
                : getEffectivePermissionsAtResourceGroup(authClient, resourceGroup.name),
        );
        if (failed(permsResult)) {
            const summary: DeploymentPermissionsSummary = {
                known: false,
                allGranted: false,
                actions: [],
                detail: l10n.t("Couldn't read effective permissions: {0}", permsResult.error),
            };
            stage.warn(summary.detail);
            return summary;
        }

        const actions: DeploymentActionResult[] = probes.map((p) => ({
            label: p.label,
            action: p.action,
            granted: findGrantingAction(permsResult.result, p.action, p.kind).granted,
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
        return summary;
    } catch (e) {
        token.throwIfCancelled();
        const summary: DeploymentPermissionsSummary = {
            known: false,
            allGranted: false,
            actions: [],
            detail: l10n.t("Couldn't probe deployment permissions: {0}", getErrorMessage(e)),
        };
        stage.warn(summary.detail);
        return summary;
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
