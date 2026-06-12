import {
    AuthorizationManagementClient,
    RoleAssignment,
    RoleAssignmentCreateParameters,
} from "@azure/arm-authorization";
import { v4 as uuidv4 } from "uuid";
import { getAuthorizationManagementClient, listAll } from "./arm";
import { createGraphClient, getCurrentUserId } from "./graph";
import { acrProvider, acrResourceName } from "./azureResources";
import { Errorable, failed, getErrorMessage } from "./errorable";
import { ReadyAzureSessionProvider } from "../../auth/types";

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

// Only these built-in roles can create the AcrPull / cluster RBAC assignments the
// deployment needs; Contributor notably cannot assign roles.
const ROLE_ASSIGNMENT_CAPABLE = new Set<string>([ROLE_OWNER, ROLE_USER_ACCESS_ADMINISTRATOR, ROLE_RBAC_ADMINISTRATOR]);

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
    const canAssignRoles = roleDefinitionIds.some((id) => ROLE_ASSIGNMENT_CAPABLE.has(id));

    return { succeeded: true, result: { roleNames, canAssignRoles } };
}
