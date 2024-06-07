import { AuthorizationManagementClient, RoleAssignment } from "@azure/arm-authorization";
import { Errorable } from "./errorable";
import { listAll } from "./arm";

export function getAllRoleAssignmentsForPrincipal(
    client: AuthorizationManagementClient,
    principalId: string,
): Promise<Errorable<RoleAssignment[]>> {
    return listAll(client.roleAssignments.listForSubscription({ filter: `principalId eq '${principalId}'` }));
}
