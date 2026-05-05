import { ReadyAzureSessionProvider } from "../../auth/types";
import { AcrKey, ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { Errorable, failed } from "./errorable";
import { getClusterPrincipalId } from "./identities";
import { principalHasAcrPullForAcr } from "./acrRoleHelpers";

export async function checkKickstartPermissions(
    sessionProvider: ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
    acrKey: AcrKey,
): Promise<Errorable<{ hasAcrPull: boolean; attached: boolean }>> {
    const principalId = await getClusterPrincipalId(sessionProvider, clusterKey);
    if (failed(principalId)) {
        return principalId;
    }

    const hasAcrPullResult = await principalHasAcrPullForAcr(sessionProvider, principalId.result, acrKey);
    if (failed(hasAcrPullResult)) {
        return hasAcrPullResult;
    }

    // In this codebase, "ACR attached to cluster" is defined as the cluster's kubelet identity
    // having the AcrPull role assignment on the ACR. See azureSelections.ts:getAttachedAcrs.
    // Therefore attached === hasAcrPull is correct by design.
    return {
        succeeded: true,
        result: {
            hasAcrPull: hasAcrPullResult.result,
            attached: hasAcrPullResult.result,
        },
    };
}
