import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ManagedCluster } from "@azure/arm-containerservice";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { AcrKey, ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { getAuthorizationManagementClient, listAll } from "./arm";
import { createGraphClient, getCurrentUserId } from "./graph";
import { Errorable, failed } from "./errorable";
import { getScopeForAcr, getScopeForCluster } from "./roleAssignments";

// Built-in Azure role definition IDs. Single source of truth — also imported
// by aksContainerAssist/oidcSetup.ts.
// https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
export const AKS_CLUSTER_USER_ROLE_ID = "4abbcc35-e782-43d8-92c5-2d3f1bd2253f";
export const AKS_RBAC_WRITER_ROLE_ID = "a7ffa36f-339b-4b5c-8bdf-e2c188b2c0eb";
export const AKS_RBAC_ADMIN_ROLE_ID = "3498e952-d568-435e-9b2c-8d77e338d7f7";
export const AKS_RBAC_CLUSTER_ADMIN_ROLE_ID = "b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b";
export const AKS_NAMESPACE_CONTRIBUTOR_ROLE_ID = "289d8817-ee69-43f1-a0af-43a45505b488";
export const ACR_PUSH_ROLE_ID = "8311e382-0749-4cb8-b61a-304f252e45ec";
export const ACR_TASKS_CONTRIBUTOR_ROLE_ID = "fb382eab-e894-4461-af04-94435c366c3f";

/** Roles that satisfy `kubectl apply` (Writer ⊂ Admin ⊂ Cluster Admin). */
const DEPLOY_CAPABLE_ROLE_IDS: readonly string[] = [
    AKS_RBAC_WRITER_ROLE_ID,
    AKS_RBAC_ADMIN_ROLE_ID,
    AKS_RBAC_CLUSTER_ADMIN_ROLE_ID,
];

export const ROLE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
    [AKS_CLUSTER_USER_ROLE_ID]: "Azure Kubernetes Service Cluster User Role",
    [AKS_RBAC_WRITER_ROLE_ID]: "Azure Kubernetes Service RBAC Writer",
    [AKS_RBAC_ADMIN_ROLE_ID]: "Azure Kubernetes Service RBAC Admin",
    [AKS_RBAC_CLUSTER_ADMIN_ROLE_ID]: "Azure Kubernetes Service RBAC Cluster Admin",
    [AKS_NAMESPACE_CONTRIBUTOR_ROLE_ID]: "Azure Kubernetes Service Namespace Contributor",
    [ACR_PUSH_ROLE_ID]: "AcrPush",
    [ACR_TASKS_CONTRIBUTOR_ROLE_ID]: "Container Registry Tasks Contributor",
};

/** True if an ARM error message indicates the caller lacks RBAC for the operation. */
export function isAuthorizationError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes("authorizationfailed") ||
        lower.includes("forbidden") ||
        lower.includes("does not have authorization")
    );
}

/** Azure RBAC for Kubernetes is always on for AKS Automatic; opt-in for Standard. */
export function isAzureRbacEnabled(cluster: ManagedCluster): boolean {
    const aad = (
        cluster as unknown as {
            aadProfile?: { enableAzureRBAC?: boolean; enableAzureRbac?: boolean };
        }
    ).aadProfile;
    return aad?.enableAzureRBAC === true || aad?.enableAzureRbac === true;
}

interface ScopeRolesResult {
    /** Lowercased role-definition GUIDs assigned to the user at (or inherited above) the scope. */
    roleIds: Set<string>;
    /** True when listing was blocked by 403; caller should warn, not fail. */
    inconclusive: boolean;
    /** Underlying error message when inconclusive. */
    reason?: string;
}

/** Lists the user's role-definition IDs at a scope, including inherited assignments. */
async function getUserRoleIdsAtScope(
    client: AuthorizationManagementClient,
    scope: string,
    userObjectId: string,
): Promise<Errorable<ScopeRolesResult>> {
    const listResult = await listAll(
        client.roleAssignments.listForScope(scope, { filter: `assignedTo('${userObjectId}')` }),
    );

    if (failed(listResult)) {
        if (isAuthorizationError(listResult.error)) {
            return {
                succeeded: true,
                result: { roleIds: new Set(), inconclusive: true, reason: listResult.error },
            };
        }
        return listResult;
    }

    const roleIds = new Set<string>();
    for (const ra of listResult.result) {
        const roleDefName = ra.roleDefinitionId?.split("/").pop();
        if (roleDefName) roleIds.add(roleDefName.toLowerCase());
    }
    return { succeeded: true, result: { roleIds, inconclusive: false } };
}

export interface DeployRbacCheckResult {
    azureRbacEnabled: boolean;
    userObjectId: string;

    // Cluster scope
    hasDeployRole: boolean;
    matchingDeployRoles: string[];
    clusterScopeInconclusive: boolean;

    // ACR scope
    hasAcrPushRole: boolean;
    hasAcrTasksContributorRole: boolean;
    acrScopeInconclusive: boolean;
}

/**
 * Pre-flight check: does the signed-in user have the Azure roles needed for a
 * Kickstart deploy (Normal Namespace path)?
 *
 *   Cluster: AKS RBAC Writer/Admin/Cluster Admin   (only if Azure RBAC enabled)
 *   ACR:     AcrPush + Container Registry Tasks Contributor
 *
 * `atScope()` includes RG/subscription/MG-inherited assignments. A 403 on
 * enumeration sets the matching `*Inconclusive` flag — callers should warn,
 * not block. Mirrors `oidcSetup.ts:assignUserNamespaceDeploymentRoles`.
 */
export async function checkUserDeployRbac(
    sessionProvider: ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
    cluster: ManagedCluster,
    acrKey: AcrKey,
): Promise<Errorable<DeployRbacCheckResult>> {
    const graphClient = createGraphClient(sessionProvider);
    const userIdResult = await getCurrentUserId(graphClient);
    if (failed(userIdResult)) {
        return { succeeded: false, error: `Could not determine signed-in user object ID: ${userIdResult.error}` };
    }
    const userObjectId = userIdResult.result;

    const client = getAuthorizationManagementClient(sessionProvider, clusterKey.subscriptionId);
    const clusterScope = getScopeForCluster(
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );
    const acrScope = getScopeForAcr(acrKey.subscriptionId, acrKey.resourceGroup, acrKey.acrName);

    const [clusterRolesResult, acrRolesResult] = await Promise.all([
        getUserRoleIdsAtScope(client, clusterScope, userObjectId),
        getUserRoleIdsAtScope(client, acrScope, userObjectId),
    ]);

    if (failed(clusterRolesResult)) return clusterRolesResult;
    if (failed(acrRolesResult)) return acrRolesResult;

    const clusterRoles = clusterRolesResult.result;
    const acrRoles = acrRolesResult.result;

    const matchingDeployRoles = DEPLOY_CAPABLE_ROLE_IDS.filter((id) => clusterRoles.roleIds.has(id)).map(
        (id) => ROLE_DISPLAY_NAMES[id] ?? id,
    );

    return {
        succeeded: true,
        result: {
            azureRbacEnabled: isAzureRbacEnabled(cluster),
            userObjectId,
            hasDeployRole: matchingDeployRoles.length > 0,
            matchingDeployRoles,
            clusterScopeInconclusive: clusterRoles.inconclusive,
            hasAcrPushRole: acrRoles.roleIds.has(ACR_PUSH_ROLE_ID),
            hasAcrTasksContributorRole: acrRoles.roleIds.has(ACR_TASKS_CONTRIBUTOR_ROLE_ID),
            acrScopeInconclusive: acrRoles.inconclusive,
        },
    };
}
