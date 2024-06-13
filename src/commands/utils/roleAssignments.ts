import {
    AuthorizationManagementClient,
    RoleAssignment,
    RoleAssignmentCreateParameters,
} from "@azure/arm-authorization";
import { Errorable, failed, getErrorMessage } from "./errorable";
import { listAll } from "./arm";
import { v4 as uuidv4 } from "uuid";
import { acrProvider, acrResourceName } from "./azureResources";

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
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${acrProvider}/registries/${acrName}`;
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
    principalType: PrincipalType,
    scope: string,
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
