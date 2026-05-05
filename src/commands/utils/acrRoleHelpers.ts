import { ReadyAzureSessionProvider } from "../../auth/types";
import { AcrKey, acrPullRoleDefinitionName } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { getAuthorizationManagementClient } from "./arm";
import { Errorable, failed } from "./errorable";
import { getPrincipalRoleAssignmentsForAcr } from "./roleAssignments";

export async function principalHasAcrPullForAcr(
    sessionProvider: ReadyAzureSessionProvider,
    principalId: string,
    acrKey: AcrKey,
): Promise<Errorable<boolean>> {
    const client = getAuthorizationManagementClient(sessionProvider, acrKey.subscriptionId);
    const roleAssignmentsResult = await getPrincipalRoleAssignmentsForAcr(
        client,
        principalId,
        acrKey.resourceGroup,
        acrKey.acrName,
    );

    if (failed(roleAssignmentsResult)) {
        return roleAssignmentsResult;
    }

    const hasAcrPull = roleAssignmentsResult.result.some(
        (ra) => ra.roleDefinitionId && ra.roleDefinitionId.split("/").pop() === acrPullRoleDefinitionName,
    );

    return { succeeded: true, result: hasAcrPull };
}
