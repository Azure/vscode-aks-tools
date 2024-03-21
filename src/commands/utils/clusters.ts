import {
    API,
    APIAvailable,
    CloudExplorerV1,
    ClusterExplorerV1,
    ConfigurationV1,
    extension,
} from "vscode-kubernetes-tools-api";
import { AksClusterTreeNode } from "../../tree/aksClusterTreeItem";
import * as azcs from "@azure/arm-containerservice";
import { Errorable, failed, getErrorMessage, map as errmap, succeeded } from "./errorable";
import { SubscriptionTreeNode, isSubscriptionTreeNode } from "../../tree/subscriptionTreeItem";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { getKubeloginBinaryPath } from "./helper/kubeloginDownload";
import { longRunning } from "./host";
import { dirSync } from "tmp";
import { TokenInfo } from "../../auth/types";
import { AuthenticationSession, authentication } from "vscode";
import { getTokenInfo } from "../../auth/azureAuth";
import { getAksClient, listAll } from "./arm";

export interface KubernetesClusterInfo {
    readonly name: string;
    readonly kubeconfigYaml: string;
}

/**
 * A managed cluster with the name and location properties guaranteed to be defined.
 */
export type DefinedManagedCluster = azcs.ManagedCluster & Required<Pick<azcs.ManagedCluster, "name" | "location">>;

export async function getKubernetesClusterInfo(
    commandTarget: unknown,
    cloudExplorer: APIAvailable<CloudExplorerV1>,
    clusterExplorer: APIAvailable<ClusterExplorerV1>,
): Promise<Errorable<KubernetesClusterInfo>> {
    // See if this is an AKS cluster, and if so, download the credentials for it.
    const clusterNode = getAksClusterTreeNode(commandTarget, cloudExplorer);
    if (succeeded(clusterNode)) {
        const properties = await longRunning(`Getting properties for cluster ${clusterNode.result.name}.`, () =>
            getManagedCluster(
                clusterNode.result.subscription.subscriptionId,
                clusterNode.result.resourceGroupName,
                clusterNode.result.name,
            ),
        );
        if (failed(properties)) {
            return properties;
        }

        const kubeconfigYaml = await getKubeconfigYaml(
            clusterNode.result.subscription.subscriptionId,
            clusterNode.result.resourceGroupName,
            properties.result,
        );
        if (failed(kubeconfigYaml)) {
            return kubeconfigYaml;
        }

        const result = {
            name: clusterNode.result.name,
            kubeconfigYaml: kubeconfigYaml.result,
        };

        return { succeeded: true, result };
    }

    const configuration = await extension.configuration.v1;
    if (!configuration.available) {
        return { succeeded: false, error: "Unable to retrieve kubeconfig: configuration API unavailable." };
    }

    // Not an AKS cluster. This should be a cluster-explorer node. Verify:
    const explorerCluster = clusterExplorer.api.resolveCommandTarget(
        commandTarget,
    ) as ClusterExplorerV1.ClusterExplorerContextNode;
    if (explorerCluster === undefined) {
        return { succeeded: false, error: "This command should only apply to active cluster nodes." };
    }

    const kubeconfigPath = getPath(await configuration.api.getKubeconfigPath());
    const result = {
        name: explorerCluster.name,
        kubeconfigYaml: fs.readFileSync(kubeconfigPath, "utf8"),
    };

    return { succeeded: true, result };
}

function getPath(kubeconfigPath: ConfigurationV1.KubeconfigPath): string {
    // Get the path of the kubeconfig file used by the cluster explorer.
    // See: https://github.com/vscode-kubernetes-tools/vscode-kubernetes-tools/blob/master/docs/extending/configuration.md#detecting-the-kubernetes-configuration
    switch (kubeconfigPath.pathType) {
        case "host":
            return kubeconfigPath.hostPath;
        case "wsl":
            return kubeconfigPath.wslPath;
    }
}

export function getAksClusterTreeNode(
    commandTarget: unknown,
    cloudExplorer: API<CloudExplorerV1>,
): Errorable<AksClusterTreeNode> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: "Cloud explorer is unavailable." };
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(
        commandTarget,
    ) as CloudExplorerV1.CloudExplorerResourceNode;

    const isClusterTarget =
        cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource?.nodeType === "cluster";

    if (!isClusterTarget) {
        return { succeeded: false, error: "This command only applies to AKS clusters." };
    }

    return { succeeded: true, result: cloudTarget.cloudResource };
}

export function getAksClusterSubscriptionNode(
    commandTarget: unknown,
    cloudExplorer: API<CloudExplorerV1>,
): Errorable<SubscriptionTreeNode> {
    if (isSubscriptionTreeNode(commandTarget)) {
        return { succeeded: true, result: commandTarget };
    }

    if (!cloudExplorer.available) {
        return { succeeded: false, error: "Cloud explorer is unavailable." };
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(
        commandTarget,
    ) as CloudExplorerV1.CloudExplorerResourceNode;

    const isAKSSubscriptionTarget =
        cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource?.nodeType === "subscription";

    if (!isAKSSubscriptionTarget) {
        return { succeeded: false, error: "This command only applies to AKS subscription." };
    }

    return { succeeded: true, result: cloudTarget.cloudResource };
}

export async function getKubeconfigYaml(
    subscriptionId: string,
    resourceGroup: string,
    managedCluster: DefinedManagedCluster,
): Promise<Errorable<string>> {
    const client = getAksClient(subscriptionId);
    return managedCluster.aadProfile
        ? getAadKubeconfig(client, resourceGroup, managedCluster.name)
        : getNonAadKubeconfig(client, resourceGroup, managedCluster.name);
}

async function getNonAadKubeconfig(
    client: azcs.ContainerServiceClient,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(resourceGroup, clusterName);
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve user credentials for non-AAD cluster ${clusterName}: ${e}`,
        };
    }

    return getClusterUserKubeconfig(clusterUserCredentials, clusterName);
}

type KubeConfigExecBlock = {
    command: string;
    args: string[];
};

type KubeConfigUser = {
    user: {
        exec: KubeConfigExecBlock;
    };
};

type KubeConfig = {
    users: KubeConfigUser[];
};

async function getAadKubeconfig(
    client: azcs.ContainerServiceClient,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        // For AAD clusters, force the credentials to be in 'exec' format.
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(resourceGroup, clusterName, {
            format: azcs.KnownFormat.Exec,
        });
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve user credentials for AAD cluster ${clusterName}: ${e}`,
        };
    }

    // The initial credentials contain an 'exec' section that calls kubelogin with devicecode authentication.
    const unauthenticatedKubeconfig = getClusterUserKubeconfig(clusterUserCredentials, clusterName);
    if (failed(unauthenticatedKubeconfig)) {
        return unauthenticatedKubeconfig;
    }

    // Parse the kubeconfig YAML into an object so that we can read and update exec options.
    let kubeconfigYaml: KubeConfig;
    try {
        kubeconfigYaml = yaml.load(unauthenticatedKubeconfig.result) as KubeConfig;
    } catch (e) {
        return { succeeded: false, error: `Failed to parse kubeconfig YAML for ${clusterName}: ${e}` };
    }

    // We expect there will be just one user in the kubeconfig. Read the 'exec' arguments for it.
    const execBlock = kubeconfigYaml.users[0].user.exec;
    const execOptions = readExecOptions(execBlock.args);

    // Get a token whose audience is the AKS server ID.
    const scopes = [`${execOptions.serverId}/.default`, `VSCODE_TENANT:${execOptions.tenantId}`];
    let session: AuthenticationSession;
    try {
        session = await authentication.getSession("microsoft", scopes, { createIfNone: true });
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve Microsoft authentication session for scopes [${scopes.join(",")}]: ${getErrorMessage(e)}`,
        };
    }

    const tokenInfo = getTokenInfo(session);
    if (failed(tokenInfo)) {
        return tokenInfo;
    }

    // Now we have a token the user can use to access their cluster, but kubelogin doesn't support that being passed as an
    // argument directly. Instead, we can save it to a temp directory and instruct kubelogin to use that as its cache directory.
    const cacheDir = storeCachedAadToken(tokenInfo.result, execOptions);
    if (failed(cacheDir)) {
        return cacheDir;
    }

    // This extension controls the version of kubelogin used, so that:
    // 1. We don't need to rely on the user having previously downloaded it, and
    // 2. This workflow doesn't get broken by kubelogin behaviour changes between versions
    const kubeloginPath = await getKubeloginBinaryPath();
    if (failed(kubeloginPath)) {
        return kubeloginPath;
    }

    // Update the kubeconfig YAML with the new kubelogin options, and return the serialized output as a string.
    execBlock.command = kubeloginPath.result;
    execBlock.args = buildExecOptionsWithCache(execOptions, cacheDir.result);
    const authenticatedKubeConfig = yaml.dump(kubeconfigYaml);
    return { succeeded: true, result: authenticatedKubeConfig };
}

interface ExecOptions {
    subcommand: string;
    environment: string;
    serverId: string;
    clientId: string;
    tenantId: string;
    loginMethod: string;
}

function readExecOptions(execArgs: string[]): ExecOptions {
    // The 'exec' command args are made up of a subcommand (get-token) and a number of name/value options.
    const [subcommand, ...options] = execArgs;

    // Extract the options into an object for convenient lookup.
    // The options look like "--<name1> <value1> --<name2> <value2> ...", so we iterate through the array in steps of 2, and at each stop:
    // - extract the option name and value for that index
    // - merge them into an object that we iteratively build up
    const optionLookup: { [name: string]: string } = options.reduce(
        (result: { [name: string]: string }, _arg: string, index: number) => {
            return index % 2 === 0 ? { ...result, [options[index]]: options[index + 1] } : result;
        },
        {},
    );

    return {
        subcommand,
        environment: optionLookup["--environment"] || optionLookup["-e"],
        serverId: optionLookup["--server-id"],
        clientId: optionLookup["--client-id"],
        tenantId: optionLookup["--tenant-id"],
        loginMethod: optionLookup["--login"] || optionLookup["-l"],
    };
}

function buildExecOptionsWithCache(execOptions: ExecOptions, cacheDir: string) {
    return [
        execOptions.subcommand,
        "--environment",
        execOptions.environment,
        "--server-id",
        execOptions.serverId,
        "--client-id",
        execOptions.clientId,
        "--tenant-id",
        execOptions.tenantId,
        // Counter-intuitively, the most appropriate login-type here is 'interactive'. This will run silently with a cached credential, and
        // if the credential is missing or expired it will launch a web-browser, which is more applicable to a GUI environment than a device
        // code that needs to be copied from a command line.
        "--login",
        "interactive",
        "--token-cache-dir",
        cacheDir,
    ];
}

function storeCachedAadToken(tokenInfo: TokenInfo, execOptions: ExecOptions): Errorable<string> {
    // kubelogin supports an extra option '--token-cache-dir' where it expects to find cached credentials.
    // If our credential is found in there, it won't initiate an interactive login.
    // It will look for a file with a specific name based on the options supplied:
    const expectedFilename = `${execOptions.environment}-${execOptions.serverId}-${execOptions.clientId}-${execOptions.tenantId}.json`;
    const cacheDirObj = dirSync();
    const cacheFilePath = path.join(cacheDirObj.name, expectedFilename);

    const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    const expiryTimestamp = Math.floor(tokenInfo.expiry.getTime() / 1000);
    const cachedTokenData = {
        access_token: tokenInfo.token,
        refresh_token: "",
        expires_in: expiryTimestamp - nowTimestamp,
        expires_on: expiryTimestamp,
        not_before: 0,
        resource: execOptions.serverId,
        token_type: "",
    };

    try {
        fs.writeFileSync(cacheFilePath, JSON.stringify(cachedTokenData));
        return { succeeded: true, result: cacheDirObj.name };
    } catch (e) {
        return { succeeded: false, error: `Unable to save ${cacheFilePath}: ${e}` };
    }
}

function getClusterUserKubeconfig(credentialResults: azcs.CredentialResults, clusterName: string): Errorable<string> {
    const kubeconfigCredResult = credentialResults.kubeconfigs!.find((kubeInfo) => kubeInfo.name === "clusterUser");
    if (kubeconfigCredResult === undefined) {
        return { succeeded: false, error: `No "clusterUser" kubeconfig found for cluster ${clusterName}.` };
    }

    const kubeconfig = kubeconfigCredResult.value?.toString();
    if (kubeconfig === undefined) {
        return { succeeded: false, error: `Empty kubeconfig for cluster ${clusterName}.` };
    }

    return { succeeded: true, result: kubeconfig };
}

export async function getClustersByResourceGroup(
    subscriptionId: string,
    resourceGroup: string,
): Promise<Errorable<DefinedManagedCluster[]>> {
    const client = getAksClient(subscriptionId);
    const clusters = await listAll(client.managedClusters.listByResourceGroup(resourceGroup));
    return errmap(clusters, (c) => c.filter(isDefinedManagedCluster));
}

export async function getManagedCluster(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<DefinedManagedCluster>> {
    const client = getAksClient(subscriptionId);
    try {
        const managedCluster = await client.managedClusters.get(resourceGroup, clusterName);
        if (isDefinedManagedCluster(managedCluster)) {
            return { succeeded: true, result: managedCluster };
        }
        return {
            succeeded: false,
            error: `Failed to retrieve Cluster ${clusterName}`,
        };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve cluster ${clusterName}: ${e}` };
    }
}

export async function getKubernetesVersionInfo(
    client: azcs.ContainerServiceClient,
    location: string,
): Promise<Errorable<azcs.KubernetesVersionListResult>> {
    try {
        const managedCluster = await client.managedClusters.listKubernetesVersions(location);
        return { succeeded: true, result: managedCluster };
    } catch (e) {
        return { succeeded: false, error: `Failed to list Kubernetes versions in ${location}: ${getErrorMessage(e)}` };
    }
}

export async function getWindowsNodePoolKubernetesVersions(
    containerClient: azcs.ContainerServiceClient,
    resourceGroupName: string,
    clusterName: string,
): Promise<Errorable<string[]>> {
    try {
        const k8sVersions: string[] = [];
        for await (const page of containerClient.agentPools.list(resourceGroupName, clusterName).byPage()) {
            for (const nodePool of page) {
                if (!nodePool.osType) {
                    return {
                        succeeded: false,
                        error: `OS type not available for node pool ${nodePool.name} for cluster ${clusterName}`,
                    };
                }

                if (nodePool.osType.toUpperCase() === "WINDOWS") {
                    if (!nodePool.currentOrchestratorVersion) {
                        return {
                            succeeded: false,
                            error: `Kubernetes version not available for node pool ${nodePool.name} for cluster ${clusterName}`,
                        };
                    }

                    k8sVersions.push(nodePool.currentOrchestratorVersion);
                }
            }
        }

        return { succeeded: true, result: k8sVersions };
    } catch (ex) {
        return {
            succeeded: false,
            error: `Error retrieving Windows node pool Kubernetes versions for ${clusterName}: ${ex}`,
        };
    }
}

export async function deleteCluster(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    try {
        const containerClient = getAksClient(subscriptionId);
        await containerClient.managedClusters.beginDeleteAndWait(resourceGroup, clusterName);

        return { succeeded: true, result: "Delete cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}` };
    }
}

export async function reconcileUsingUpdateInCluster(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    const clusterInfo = await getManagedCluster(subscriptionId, resourceGroup, clusterName);
    if (failed(clusterInfo)) {
        return clusterInfo;
    }

    try {
        // Pleaset note: here is in the only place this way of reconcile is documented: https://learn.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest#az-aks-update()-examples
        const containerClient = getAksClient(subscriptionId);
        await containerClient.managedClusters.beginCreateOrUpdateAndWait(resourceGroup, clusterName, {
            location: clusterInfo.result.location,
        });

        return { succeeded: true, result: "Reconcile/Update cluster succeeded." };
    } catch (ex) {
        return {
            succeeded: false,
            error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}`,
        };
    }
}

export async function rotateClusterCert(
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<string>> {
    try {
        const containerClient = getAksClient(subscriptionId);
        await containerClient.managedClusters.beginRotateClusterCertificatesAndWait(resourceGroup, clusterName);

        return { succeeded: true, result: `Rotate cluster certificate for ${clusterName} succeeded.` };
    } catch (ex) {
        return {
            succeeded: false,
            error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}`,
        };
    }
}

function isDefinedManagedCluster(cluster: azcs.ManagedCluster): cluster is DefinedManagedCluster {
    return cluster.name !== undefined && cluster.location !== undefined;
}
