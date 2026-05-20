import { getReadySessionProvider } from "../../auth/azureAuth";
import { getAuthenticatedKubeconfigYaml, getKubeconfigYaml, getManagedCluster } from "../../commands/utils/clusters";
import { Errorable, failed } from "../../commands/utils/errorable";
import { TempFile, createTempFile } from "../../commands/utils/tempfile";
import { ConfigData } from "./state";

/**
 * Fetches an authenticated kubeconfig for the kickstart target cluster and
 * writes it to a temp file ready for `kubectl ... --kubeconfig=<path>` use.
 *
 * Shared by the DEPLOY and VERIFY phases so they go through the same Azure-SDK
 * based path rather than relying on the user's local `kubectl config` context.
 *
 * The returned `TempFile` is disposable and the caller is responsible for
 * disposing it (typically inside a `try { ... } finally { file.dispose(); }`).
 */
export async function acquireKubeconfigFile(config: ConfigData): Promise<Errorable<TempFile>> {
    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        return { succeeded: false, error: `Could not acquire Azure session: ${sessionProvider.error}` };
    }

    const managedCluster = await getManagedCluster(
        sessionProvider.result,
        config.subscriptionId,
        config.resourceGroup,
        config.clusterName,
    );
    if (failed(managedCluster)) {
        return {
            succeeded: false,
            error: `Could not load cluster '${config.clusterName}': ${managedCluster.error}`,
        };
    }

    const rawKubeconfig = await getKubeconfigYaml(
        sessionProvider.result,
        config.subscriptionId,
        config.resourceGroup,
        managedCluster.result,
    );
    if (failed(rawKubeconfig)) {
        return {
            succeeded: false,
            error: `Could not retrieve kubeconfig for '${config.clusterName}': ${rawKubeconfig.error}`,
        };
    }

    const authenticatedConfig = await getAuthenticatedKubeconfigYaml(rawKubeconfig.result);
    if (failed(authenticatedConfig)) {
        return { succeeded: false, error: `Could not authenticate kubeconfig: ${authenticatedConfig.error}` };
    }

    const tempFile = await createTempFile(authenticatedConfig.result, "yaml");
    return { succeeded: true, result: tempFile };
}
