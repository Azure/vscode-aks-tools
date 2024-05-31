import {
    AuthorizationManagementClient,
    RoleAssignment,
    RoleAssignmentCreateParameters,
} from "@azure/arm-authorization";
import { getRandomValues } from "crypto";
import { Errorable, failed, getErrorMessage } from "./errorable";
import { listAll } from "./arm";

export function getPrincipalRoleAssignmentsForAcr(
    client: AuthorizationManagementClient,
    principalId: string,
    acrResourceGroup: string,
    acrName: string,
): Promise<Errorable<RoleAssignment[]>> {
    return listAll(
        client.roleAssignments.listForResource(acrResourceGroup, "Microsoft.ContainerRegistry", "registries", acrName, {
            filter: `principalId eq '${principalId}'`,
        }),
    );
}

export function getPrincipalRoleAssignmentsForCluster(
    client: AuthorizationManagementClient,
    principalId: string,
    clusterResourceGroup: string,
    clusterName: string,
): Promise<Errorable<RoleAssignment[]>> {
    return listAll(
        client.roleAssignments.listForResource(
            clusterResourceGroup,
            "Microsoft.ContainerService",
            "managedClusters",
            clusterName,
            {
                filter: `principalId eq '${principalId}'`,
            },
        ),
    );
}

export function getScopeForAcr(subscriptionId: string, resourceGroup: string, acrName: string): string {
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${acrName}`;
}

export function getScopeForCluster(subscriptionId: string, resourceGroup: string, clusterName: string): string {
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
}

export async function createRoleAssignment(
    client: AuthorizationManagementClient,
    subscriptionId: string,
    principalId: string,
    roleDefinitionName: string,
    principalType: "ServicePrincipal" | "User",
    scope: string,
): Promise<Errorable<RoleAssignment>> {
    const newRoleAssignmentName = uuidv4();
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

function uuidv4(): string {
    // https://stackoverflow.com/a/2117523
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    );
}
