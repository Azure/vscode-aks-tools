import { l10n } from "vscode";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { getManagedCluster } from "./clusters";
import { Errorable, failed } from "./errorable";

/**
 * Returns the principal ID used for ACR role assignments for the given cluster.
 * For clusters with a managed identity, returns the kubelet identity objectId.
 * For clusters without a managed identity, falls back to the service principal clientId.
 *
 * This is adapted from the Azure CLI implementation of `az aks update --attach-acr`.
 */
export async function getClusterPrincipalId(
    sessionProvider: ReadyAzureSessionProvider,
    clusterKey: ClusterKey,
): Promise<Errorable<string>> {
    const cluster = await getManagedCluster(
        sessionProvider,
        clusterKey.subscriptionId,
        clusterKey.resourceGroup,
        clusterKey.clusterName,
    );
    if (failed(cluster)) {
        return cluster;
    }

    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/_helpers.py#L79-L88
    const hasManagedIdentity =
        cluster.result.identity?.type === "SystemAssigned" || cluster.result.identity?.type === "UserAssigned";
    if (hasManagedIdentity) {
        // For the case where the cluster _has_ a managed identity, use `objectId` from the `kubeletidentity` profile.
        // see: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L6808-L6815
        if (
            cluster.result.identityProfile &&
            "kubeletidentity" in cluster.result.identityProfile &&
            cluster.result.identityProfile.kubeletidentity.objectId
        ) {
            return {
                succeeded: true,
                result: cluster.result.identityProfile.kubeletidentity.objectId,
            };
        }

        return {
            succeeded: false,
            error: l10n.t("Cluster has managed identity but no kubelet identity"),
        };
    }

    // Fall back to the `clientId` property of the service principal profile
    // for the case where the cluster has no managed identity:
    // See: https://github.com/Azure/azure-cli/blob/a267cc2ddcd09e39fcaf6af0bc20d409218a5bbc/src/azure-cli/azure/cli/command_modules/acs/managed_cluster_decorator.py#L5787-L5795
    const servicePrincipalId = cluster.result.servicePrincipalProfile?.clientId;
    if (servicePrincipalId) {
        return {
            succeeded: true,
            result: servicePrincipalId,
        };
    }

    return {
        succeeded: false,
        error: l10n.t("Cluster has no managed identity or service principal"),
    };
}
