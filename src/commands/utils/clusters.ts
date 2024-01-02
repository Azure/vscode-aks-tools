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
import { Errorable, failed, getErrorMessage, succeeded } from "./errorable";
import { ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { SubscriptionTreeNode } from "../../tree/subscriptionTreeItem";
import { getAksAadAccessToken } from "./authProvider";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { AuthenticationResult } from "@azure/msal-node";
import { getKubeloginBinaryPath } from "./helper/kubeloginDownload";
import { longRunning } from "./host";
import { dirSync } from "tmp";

export interface KubernetesClusterInfo {
    readonly name: string;
    readonly kubeconfigYaml: string;
}

export async function getKubernetesClusterInfo(
    commandTarget: unknown,
    cloudExplorer: APIAvailable<CloudExplorerV1>,
    clusterExplorer: APIAvailable<ClusterExplorerV1>,
): Promise<Errorable<KubernetesClusterInfo>> {
    // See if this is an AKS cluster, and if so, download the credentials for it.
    const clusterNode = getAksClusterTreeNode(commandTarget, cloudExplorer);
    if (succeeded(clusterNode)) {
        const properties = await longRunning(`Getting properties for cluster ${clusterNode.result.name}.`, () =>
            getClusterProperties(clusterNode.result),
        );
        if (failed(properties)) {
            return properties;
        }

        const kubeconfigYaml = await getKubeconfigYaml(clusterNode.result, properties.result);
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
    clusterNode: AksClusterTreeNode,
    managedCluster: azcs.ManagedCluster,
): Promise<Errorable<string>> {
    const client = getContainerClient(clusterNode);
    return managedCluster.aadProfile ? getAadKubeconfig(clusterNode, client) : getNonAadKubeconfig(clusterNode, client);
}

async function getNonAadKubeconfig(
    clusterNode: AksClusterTreeNode,
    client: azcs.ContainerServiceClient,
): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(
            clusterNode.resourceGroupName,
            clusterNode.name,
        );
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve user credentials for non-AAD cluster ${clusterNode.name}: ${e}`,
        };
    }

    return getClusterUserKubeconfig(clusterUserCredentials, clusterNode.name);
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
    clusterNode: AksClusterTreeNode,
    client: azcs.ContainerServiceClient,
): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        // For AAD clusters, force the credentials to be in 'exec' format.
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(
            clusterNode.resourceGroupName,
            clusterNode.name,
            { format: azcs.KnownFormat.Exec },
        );
    } catch (e) {
        return {
            succeeded: false,
            error: `Failed to retrieve user credentials for AAD cluster ${clusterNode.name}: ${e}`,
        };
    }

    // The initial credentials contain an 'exec' section that calls kubelogin with devicecode authentication.
    const unauthenticatedKubeconfig = getClusterUserKubeconfig(clusterUserCredentials, clusterNode.name);
    if (failed(unauthenticatedKubeconfig)) {
        return unauthenticatedKubeconfig;
    }

    // Parse the kubeconfig YAML into an object so that we can read and update exec options.
    let kubeconfigYaml: KubeConfig;
    try {
        kubeconfigYaml = yaml.load(unauthenticatedKubeconfig.result) as KubeConfig;
    } catch (e) {
        return { succeeded: false, error: `Failed to parse kubeconfig YAML for ${clusterNode.name}: ${e}` };
    }

    // We expect there will be just one user in the kubeconfig. Read the 'exec' arguments for it.
    const execBlock = kubeconfigYaml.users[0].user.exec;
    const execOptions = readExecOptions(execBlock.args);

    // We need to supply an access token that grants the user access to the cluster. The user running this will be authenticated,
    // and we have access to their credentials here...
    const localToken = await clusterNode.subscription.credentials.getToken();

    // But, the user's token is for VS Code, and instead we need a token whose audience is the AKS server ID.
    // This can be obtained by exchanging the user's refresh token for one with the new audience.
    const aadAccessToken = await getAksAadAccessToken(
        clusterNode.subscription.environment,
        execOptions.serverId,
        execOptions.tenantId,
        localToken.refreshToken,
    );
    if (failed(aadAccessToken)) {
        return aadAccessToken;
    }

    // Now we have a token the user can use to access their cluster, but kubelogin doesn't support that being passed as an
    // argument directly. Instead, we can save it to a temp directory and instruct kubelogin to use that as its cache directory.
    const cacheDir = storeCachedAadToken(aadAccessToken.result, execOptions);
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

function storeCachedAadToken(aadAccessToken: AuthenticationResult, execOptions: ExecOptions): Errorable<string> {
    // kubelogin supports an extra option '--token-cache-dir' where it expects to find cached credentials.
    // If our credential is found in there, it won't initiate an interactive login.
    // It will look for a file with a specific name based on the options supplied:
    const expectedFilename = `${execOptions.environment}-${execOptions.serverId}-${execOptions.clientId}-${execOptions.tenantId}.json`;
    const cacheDirObj = dirSync();
    const cacheFilePath = path.join(cacheDirObj.name, expectedFilename);

    const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    const expiryTimestamp = aadAccessToken.expiresOn
        ? Math.floor(aadAccessToken.expiresOn.getTime() / 1000)
        : nowTimestamp;
    const cachedTokenData = {
        access_token: aadAccessToken.accessToken,
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

export function getClusterProperties(clusterNode: AksClusterTreeNode): Promise<Errorable<azcs.ManagedCluster>> {
    const client = getContainerClient(clusterNode);
    return getManagedCluster(client, clusterNode.resourceGroupName, clusterNode.name);
}

export async function getManagedCluster(
    client: azcs.ContainerServiceClient,
    resourceGroup: string,
    clusterName: string,
): Promise<Errorable<azcs.ManagedCluster>> {
    try {
        const managedCluster = await client.managedClusters.get(resourceGroup, clusterName);
        return { succeeded: true, result: managedCluster };
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve cluster ${clusterName}: ${e}` };
    }
}

export async function determineProvisioningState(
    clusterNode: AksClusterTreeNode,
    clusterName: string,
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(clusterNode);
        const clusterInfo = await containerClient.managedClusters.get(clusterNode.resourceGroupName, clusterName);

        return { succeeded: true, result: clusterInfo.provisioningState ?? "" };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${ex}` };
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

export function getContainerClient(treeNode: AksClusterTreeNode | SubscriptionTreeNode): azcs.ContainerServiceClient {
    const environment = treeNode.subscription.environment;
    return new azcs.ContainerServiceClient(treeNode.subscription.credentials, treeNode.subscription.subscriptionId, {
        endpoint: environment.resourceManagerEndpointUrl,
    });
}

export function getResourceManagementClient(
    treeNode: AksClusterTreeNode | SubscriptionTreeNode,
): ResourceManagementClient {
    const environment = treeNode.subscription.environment;
    return new ResourceManagementClient(treeNode.subscription.credentials, treeNode.subscription.subscriptionId, {
        endpoint: environment.resourceManagerEndpointUrl,
    });
}

export async function getResourceGroupList(client: ResourceManagementClient): Promise<Errorable<ResourceGroup[]>> {
    try {
        const resourceGroups = [];
        const result = client.resourceGroups.list();
        for await (const pageGroups of result.byPage()) {
            resourceGroups.push(...pageGroups);
        }

        return { succeeded: true, result: resourceGroups };
    } catch (ex) {
        return { succeeded: false, error: `Error listing resource groups: ${getErrorMessage(ex)}` };
    }
}

export async function deleteCluster(clusterNode: AksClusterTreeNode, clusterName: string): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(clusterNode);
        await containerClient.managedClusters.beginDeleteAndWait(clusterNode.resourceGroupName, clusterName);

        return { succeeded: true, result: "Delete cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}` };
    }
}

export async function reconcileUsingUpdateInCluster(clusterNode: AksClusterTreeNode): Promise<Errorable<string>> {
    try {
        // Pleaset note: here is in the only place this way of reconcile is documented: https://learn.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest#az-aks-update()-examples
        const containerClient = getContainerClient(clusterNode);
        const getClusterInfo = await containerClient.managedClusters.get(
            clusterNode.resourceGroupName,
            clusterNode.name,
        );
        await containerClient.managedClusters.beginCreateOrUpdateAndWait(
            clusterNode.resourceGroupName,
            clusterNode.name,
            {
                location: getClusterInfo.location,
            },
        );

        return { succeeded: true, result: "Reconcile/Update cluster succeeded." };
    } catch (ex) {
        return {
            succeeded: false,
            error: `Error invoking ${clusterNode.name} managed cluster: ${getErrorMessage(ex)}`,
        };
    }
}

export async function rotateClusterCert(clusterNode: AksClusterTreeNode): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(clusterNode);
        await containerClient.managedClusters.beginRotateClusterCertificatesAndWait(
            clusterNode.resourceGroupName,
            clusterNode.name,
        );

        return { succeeded: true, result: `Rotate cluster certificate for ${clusterNode.name} succeeded.` };
    } catch (ex) {
        return {
            succeeded: false,
            error: `Error invoking ${clusterNode.name} managed cluster: ${getErrorMessage(ex)}`,
        };
    }
}
