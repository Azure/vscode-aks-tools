import {
    AuthorizationManagementClient,
    Permission,
    RoleAssignment,
    RoleAssignmentCreateParameters,
    RoleEligibilityScheduleInstance,
} from "@azure/arm-authorization";
import { v4 as uuidv4 } from "uuid";
import { getAuthorizationManagementClient, listAll } from "./arm";
import { createGraphClient, getCurrentUserId } from "./graph";
import { acrProvider, acrResourceName } from "./azureResources";
import { Errorable, failed, getErrorMessage } from "./errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";

/** The fine-grained Azure RBAC action required to create any role assignment. */
export const ROLE_ASSIGNMENT_WRITE = "Microsoft.Authorization/roleAssignments/write";
const WILDCARD = "*";

export function getPrincipalRoleAssignmentsForAcr(
    client: AuthorizationManagementClient,
    principalId: string,
    acrResourceGroup: string,
    acrName: string,
): Promise<Errorable<RoleAssignment[]>> {
    return listAll(
        client.roleAssignments.listForResource(acrResourceGroup, acrProvider, acrResourceName, acrName, {
            filter: `principalId eq '${principalId}'`,
        }),
    );
}

export function getScopeForAcr(subscriptionId: string, resourceGroup: string, acrName: string): string {
    // ARM resource ID for ACR
    // Doc reference: https://learn.microsoft.com/en-us/azure/templates/microsoft.containerregistry/registries?pivots=deployment-language-arm-template#resource-format-1
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${acrProvider}/registries/${acrName}`;
}

export function getScopeForCluster(subscriptionId: string, resourceGroup: string, clusterName: string): string {
    // ARM resource ID for AKS
    // Doc reference: https://learn.microsoft.com/en-us/azure/templates/microsoft.containerservice/managedclusters?pivots=deployment-language-arm-template#resource-format-1
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
}

export function getScopeForManagedNamespace(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
    namespaceName: string,
): string {
    return `${getScopeForCluster(subscriptionId, resourceGroup, clusterName)}/managedNamespaces/${namespaceName}`;
}

export function getScopeForKubernetesNamespace(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
    namespaceName: string,
): string {
    // Kubernetes data-plane RBAC uses /namespaces/ (not /managedNamespaces/ which is for ARM operations)
    return `${getScopeForCluster(subscriptionId, resourceGroup, clusterName)}/namespaces/${namespaceName}`;
}

// There are several permitted principal types, see: https://learn.microsoft.com/en-us/rest/api/authorization/role-assignments/create?view=rest-authorization-2022-04-01&tabs=HTTP#principaltype
// For now, 'ServicePrincipal' and 'User' are the ones we're most likely to use here,
// but we can add more as needed.
export type PrincipalType = "ServicePrincipal" | "User";

export async function createRoleAssignment(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    principalId: string,
    roleDefinitionName: string,
    scope: string,
    principalType?: PrincipalType,
): Promise<Errorable<RoleAssignment>> {
    const newRoleAssignmentName = createRoleAssignmentName();
    const roleDefinitionId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleDefinitionName}`;

    const newRoleAssignment: RoleAssignmentCreateParameters = {
        principalId,
        roleDefinitionId,
        principalType,
    };

    try {
        const roleAssignment: RoleAssignment = await client.roleAssignments.create(
            scope,
            newRoleAssignmentName,
            newRoleAssignment,
        );
        return { succeeded: true, result: roleAssignment };
    } catch (e) {
        // Role assignment already exists — treat as idempotent success
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "RoleAssignmentExists") {
            return { succeeded: true, result: {} as RoleAssignment };
        }
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

export async function deleteRoleAssignment(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    principalId: string,
    roleDefinitionName: string,
    scope: string,
): Promise<Errorable<void>> {
    const roleDefinitionId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleDefinitionName}`;

    const roleAssignments = await listAll(client.roleAssignments.listForScope(scope));
    if (failed(roleAssignments)) {
        // Returning the inner error propagates it up the call chain.
        return roleAssignments;
    }

    const roleAssignment = roleAssignments.result.find(
        (ra) => ra.principalId === principalId && ra.roleDefinitionId === roleDefinitionId,
    );

    if (!roleAssignment) {
        return { succeeded: true, result: undefined };
    }

    if (!roleAssignment.id) {
        return { succeeded: false, error: "Role assignment has no ID" };
    }

    try {
        await client.roleAssignments.deleteById(roleAssignment.id);
        return { succeeded: true, result: undefined };
    } catch (e) {
        return { succeeded: false, error: getErrorMessage(e) };
    }
}

function createRoleAssignmentName(): string {
    // https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments#name
    // "A role assignment's resource name must be a globally unique identifier"
    return uuidv4();
}

// Well-known Azure built-in role definition GUIDs.
// https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
export const ROLE_OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
export const ROLE_CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c";
export const ROLE_USER_ACCESS_ADMINISTRATOR = "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9";
export const ROLE_RBAC_ADMINISTRATOR = "f58310d9-a9f6-439a-9e8d-f62e7b41a168";
export const ROLE_READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";

const WELL_KNOWN_ROLE_NAMES: Record<string, string> = {
    [ROLE_OWNER]: "Owner",
    [ROLE_CONTRIBUTOR]: "Contributor",
    [ROLE_USER_ACCESS_ADMINISTRATOR]: "User Access Administrator",
    [ROLE_RBAC_ADMINISTRATOR]: "Role Based Access Control Administrator",
    [ROLE_READER]: "Reader",
};

/** Least-privilege built-in role that grants {@link ROLE_ASSIGNMENT_WRITE}. */
export const RBAC_ADMIN_ROLE = WELL_KNOWN_ROLE_NAMES[ROLE_RBAC_ADMINISTRATOR];

export interface UserSubscriptionRoles {
    roleNames: string[];
    canAssignRoles: boolean;
}

export async function getUserSubscriptionRoles(
    sessionProvider: ReadyAzureSessionProvider,
    subscriptionId: string,
): Promise<Errorable<UserSubscriptionRoles>> {
    const graphClient = createGraphClient(sessionProvider);
    const userId = await getCurrentUserId(graphClient);
    if (failed(userId)) {
        return userId;
    }

    const client = getAuthorizationManagementClient(sessionProvider, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;
    const assignments = await listAll(
        client.roleAssignments.listForScope(scope, {
            filter: `atScope() and assignedTo('${userId.result}')`,
        }),
    );
    if (failed(assignments)) {
        return assignments;
    }

    const roleDefinitionIds = [
        ...new Set(
            assignments.result
                .map((ra) => ra.roleDefinitionId?.split("/").pop())
                .filter((id): id is string => Boolean(id)),
        ),
    ];

    const roleNames = roleDefinitionIds.map((id) => WELL_KNOWN_ROLE_NAMES[id] ?? "Custom role");

    // Use the ARM permissions union (not a fixed allowlist) so custom roles and NotActions are
    // evaluated correctly. Subscription-scope has no `permissions.listForScope`, so we union the
    // permissions arrays from each role definition the user holds.
    const verdictResult = await unionPermissionsForRoleDefinitions(client, subscriptionId, roleDefinitionIds);
    if (failed(verdictResult)) {
        return verdictResult;
    }
    const verdict = evaluateRoleAssignmentWrite(verdictResult.result);

    return { succeeded: true, result: { roleNames, canAssignRoles: verdict.canCreate } };
}

// ---------------------------------------------------------------------------
// Role-assignment-write probing
// ---------------------------------------------------------------------------

export type RoleAssignmentWriteVerdict = {
    /** True iff at least one held role grants the write without stripping it via NotActions. */
    canCreate: boolean;
    /** Action patterns from roles that grant the write (not stripped by NotActions). */
    grantingActions: string[];
    /**
     * Action patterns that matched a held role's `actions` but were stripped back out by that same
     * role's `notActions` (e.g. Contributor's `["*"]` minus `["Microsoft.Authorization/*\/Write"]`).
     * Informational only — a different role may still grant the action cleanly.
     */
    strippedByNotActions: string[];
};

export type EligibleGrant = {
    roleName: string;
    scopeId: string;
    scopeDisplayName?: string;
    grantingAction?: string;
};

/**
 * Evaluates a set of {@link Permission} entries to determine whether they grant
 * {@link ROLE_ASSIGNMENT_WRITE} without stripping it via `notActions`.
 *
 * Azure RBAC unions across role assignments: a NotAction in one role does NOT block an action
 * granted by another. Callers should pass every Permission they want considered (either every
 * Permission from `listForResourceGroup`, or every Permission across the role definitions the
 * user holds at sub scope).
 */
export function evaluateRoleAssignmentWrite(permissions: Permission[]): RoleAssignmentWriteVerdict {
    const grantingActions: string[] = [];
    const strippedByNotActions: string[] = [];

    for (const perm of permissions) {
        const allowed = (perm.actions ?? []).find((a) => matchesAction(a, ROLE_ASSIGNMENT_WRITE));
        if (!allowed) continue;
        const stripped = (perm.notActions ?? []).some((na) => matchesAction(na, ROLE_ASSIGNMENT_WRITE));
        (stripped ? strippedByNotActions : grantingActions).push(allowed);
    }

    return {
        canCreate: grantingActions.length > 0,
        grantingActions,
        strippedByNotActions,
    };
}

/** Tests whether an Azure RBAC action pattern (with `*` wildcards) matches a concrete action. */
export function matchesAction(pattern: string, action: string): boolean {
    if (pattern === WILDCARD || pattern === action) return true;
    if (!pattern.includes(WILDCARD)) return false;
    const regex = new RegExp(`^${pattern.split(WILDCARD).map(escapeRegex).join(".*")}$`, "i");
    return regex.test(action);
}

function escapeRegex(s: string): string {
    return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Looks up the permissions arrays for each role-definition ID the caller passes and returns the
 * concatenation. Used where ARM does not expose a direct "effective permissions" endpoint
 * (notably subscription scope).
 */
export async function unionPermissionsForRoleDefinitions(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    roleDefinitionIds: string[],
): Promise<Errorable<Permission[]>> {
    const scope = `/subscriptions/${subscriptionId}`;
    const permissions: Permission[] = [];
    for (const id of roleDefinitionIds) {
        try {
            const def = await client.roleDefinitions.get(scope, id);
            permissions.push(...(def.permissions ?? []));
        } catch {
            // A role definition we cannot read cannot grant the action. Skip silently.
        }
    }
    return { succeeded: true, result: permissions };
}

/**
 * Returns the caller's effective permissions at subscription scope. Implemented as the union of
 * permissions arrays across every role definition the user is assigned at the sub (no direct
 * "listForScope" API exists at sub level).
 */
export async function getEffectivePermissionsAtSubscription(
    sessionProvider: ReadyAzureSessionProvider,
    client: AuthorizationManagementClient,
    subscriptionId: string,
): Promise<Errorable<Permission[]>> {
    const graphClient = createGraphClient(sessionProvider);
    const userId = await getCurrentUserId(graphClient);
    if (failed(userId)) return userId;

    const assignments = await listAll(
        client.roleAssignments.listForScope(`/subscriptions/${subscriptionId}`, {
            filter: `atScope() and assignedTo('${userId.result}')`,
        }),
    );
    if (failed(assignments)) return assignments;

    const roleDefinitionIds = [
        ...new Set(
            assignments.result
                .map((ra) => ra.roleDefinitionId?.split("/").pop())
                .filter((id): id is string => Boolean(id)),
        ),
    ];
    return unionPermissionsForRoleDefinitions(client, subscriptionId, roleDefinitionIds);
}

/**
 * Returns the caller's effective permissions on a resource group via the direct
 * `permissions.listForResourceGroup` ARM API. The result already accounts for inheritance and
 * NotActions/NotDataActions stripping.
 */
export async function getEffectivePermissionsAtResourceGroup(
    client: AuthorizationManagementClient,
    resourceGroup: string,
): Promise<Errorable<Permission[]>> {
    return listAll(client.permissions.listForResourceGroup(resourceGroup));
}

/**
 * Generic action-grant checker: tests whether a set of effective permissions grants the given
 * concrete action (or dataAction) without stripping it via NotActions/NotDataActions.
 * Returns the matching action pattern via `via` for "Granted via X" reporting.
 */
export function findGrantingAction(
    permissions: Permission[],
    action: string,
    kind: "action" | "dataAction" = "action",
): { granted: boolean; via?: string } {
    for (const perm of permissions) {
        const candidates = kind === "action" ? (perm.actions ?? []) : (perm.dataActions ?? []);
        const blocklist = kind === "action" ? (perm.notActions ?? []) : (perm.notDataActions ?? []);
        const allowed = candidates.find((p) => matchesAction(p, action));
        if (!allowed) continue;
        const stripped = blocklist.some((p) => matchesAction(p, action));
        if (!stripped) return { granted: true, via: allowed };
    }
    return { granted: false };
}

/**
 * Reads the effective permissions on a resource group and decides whether the caller can create
 * role assignments there. Use this when the RG already exists; for not-yet-created RGs, fall back
 * to the subscription-scope verdict from {@link getUserSubscriptionRoles}.
 */
export async function canCreateRoleAssignmentsAtResourceGroup(
    client: AuthorizationManagementClient,
    resourceGroup: string,
): Promise<Errorable<RoleAssignmentWriteVerdict>> {
    const permissions = await getEffectivePermissionsAtResourceGroup(client, resourceGroup);
    if (failed(permissions)) return permissions;
    return { succeeded: true, result: evaluateRoleAssignmentWrite(permissions.result) };
}

/**
 * Lists the caller's PIM-eligible role assignments at the given scope (with inheritance), then
 * filters to those whose role definition would grant {@link ROLE_ASSIGNMENT_WRITE} once activated.
 */
export async function findEligiblePimGrants(
    client: AuthorizationManagementClient,
    scope: string,
    log?: (msg: string) => void,
): Promise<Errorable<EligibleGrant[]>> {
    const trace = log ?? (() => {});
    let instances: RoleEligibilityScheduleInstance[];
    try {
        trace(`[pim] listForScope ${scope} (filter: asTarget())`);
        // `asTarget()` filters to eligibilities for the current user. Inheritance applies from any
        // ancestor scope (MG/sub/RG), so a single listForScope at the RG is sufficient.
        const page = await listAll(
            client.roleEligibilityScheduleInstances.listForScope(scope, { filter: "asTarget()" }),
        );
        if (failed(page)) {
            trace(`[pim] listForScope failed: ${page.error}`);
            return page;
        }
        instances = page.result;
        trace(`[pim] listForScope returned ${instances.length} instance(s)`);
    } catch (e) {
        const msg = getErrorMessage(e);
        trace(`[pim] listForScope threw: ${msg}`);
        return { succeeded: false, error: msg };
    }

    const grants: EligibleGrant[] = [];
    const seen = new Set<string>();

    for (const inst of instances) {
        const roleDefId = inst.roleDefinitionId ?? inst.expandedProperties?.roleDefinition?.id;
        const scopeId = inst.scope ?? inst.expandedProperties?.scope?.id;
        if (!roleDefId || !scopeId) {
            trace(`[pim] instance missing roleDefinitionId/scope — skipped`);
            continue;
        }

        const dedupeKey = `${scopeId}|${roleDefId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        try {
            const def = await client.roleDefinitions.getById(roleDefId);
            const roleName = def.roleName ?? inst.expandedProperties?.roleDefinition?.displayName ?? "(unknown)";
            const verdict = evaluateRoleAssignmentWrite(def.permissions ?? []);
            if (!verdict.canCreate) {
                trace(`[pim] '${roleName}' at ${scopeId} — does not grant ${ROLE_ASSIGNMENT_WRITE}`);
                continue;
            }
            trace(`[pim] '${roleName}' at ${scopeId} — eligible`);
            grants.push({
                roleName,
                scopeId,
                scopeDisplayName: inst.expandedProperties?.scope?.displayName,
                grantingAction: verdict.grantingActions[0],
            });
        } catch (e) {
            trace(`[pim] roleDefinitions.getById(${roleDefId}) failed: ${getErrorMessage(e)}`);
        }
    }

    trace(`[pim] qualifying grants: ${grants.length}`);
    return { succeeded: true, result: grants };
}

/** Builds a copy-pasteable `az role assignment create` command for the report/remediation. */
export function azRoleAssignmentCommand(args: {
    assigneeObjectId: string;
    principalType: PrincipalType;
    role: string;
    scopeId: string;
}): string {
    return (
        "```bash\n" +
        `az role assignment create \\\n` +
        `  --assignee-object-id ${args.assigneeObjectId} \\\n` +
        `  --assignee-principal-type ${args.principalType} \\\n` +
        `  --role "${args.role}" \\\n` +
        `  --scope "${args.scopeId}"\n` +
        "```\n"
    );
}
