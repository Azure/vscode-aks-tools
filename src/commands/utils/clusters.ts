import { API, APIAvailable, CloudExplorerV1, ClusterExplorerV1, ConfigurationV1, extension } from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import * as azcs from '@azure/arm-containerservice';
import { Errorable, failed, getErrorMessage, succeeded } from './errorable';
import { ResourceGroup, ResourceManagementClient } from '@azure/arm-resources';
import SubscriptionTreeItem, { SubscriptionTreeNode } from '../../tree/subscriptionTreeItem';
import { getAksAadAccessToken } from './authProvider';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { AuthenticationResult } from '@azure/msal-node';
import { getKubeloginBinaryPath } from './helper/kubeloginDownload';
import { longRunning } from './host';
const tmp = require('tmp');

export interface ClusterARMResponse {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly resourceGroup?: string;
    readonly properties: any;
    readonly type: string;
}

export enum ClusterStartStopState {
    Started = 'Started',
    Starting = 'Starting',
    Stopped = 'Stopped',
    Stopping = 'Stopping'
}

export interface KubernetesClusterInfo {
    readonly name: string,
    readonly kubeconfigYaml: string
}

export async function getKubernetesClusterInfo(commandTarget: any, cloudExplorer: APIAvailable<CloudExplorerV1>, clusterExplorer: APIAvailable<ClusterExplorerV1>): Promise<Errorable<KubernetesClusterInfo>> {

    // See if this is an AKS cluster, and if so, download the credentials for it.
    const aksCluster = getAksClusterTreeItem(commandTarget, cloudExplorer);
    if (succeeded(aksCluster)) {
        const properties = await longRunning(`Getting properties for cluster ${aksCluster.result.name}.`, () => getClusterProperties(aksCluster.result));
        if (failed(properties)) {
            return properties;
        }
    
        const kubeconfigYaml = await getKubeconfigYaml(aksCluster.result, properties.result);
        if (failed(kubeconfigYaml)) {
            return kubeconfigYaml;
        }

        const result = {
            name: aksCluster.result.name,
            kubeconfigYaml: kubeconfigYaml.result
        };

        return {succeeded: true, result };
    }

    const configuration = await extension.configuration.v1;
    if (!configuration.available) {
        return { succeeded: false, error: 'Unable to retrieve kubeconfig: configuration API unavailable.' };
    }

    // Not an AKS cluster. This should be a cluster-explorer node. Verify:
    const explorerCluster = clusterExplorer.api.resolveCommandTarget(commandTarget) as ClusterExplorerV1.ClusterExplorerContextNode;
    if (explorerCluster === undefined) {
        return { succeeded: false, error: 'This command should only apply to active cluster nodes.' }
    }

    const kubeconfigPath = getPath(await configuration.api.getKubeconfigPath());
    const result = {
        name: explorerCluster.name,
        kubeconfigYaml: fs.readFileSync(kubeconfigPath, 'utf8')
    };

    return { succeeded: true, result };
}

function getPath(kubeconfigPath: ConfigurationV1.KubeconfigPath): string {
    // Get the path of the kubeconfig file used by the cluster explorer.
    // See: https://github.com/vscode-kubernetes-tools/vscode-kubernetes-tools/blob/master/docs/extending/configuration.md#detecting-the-kubernetes-configuration
    switch (kubeconfigPath.pathType) {
        case 'host':
            return kubeconfigPath.hostPath;
        case 'wsl':
            return kubeconfigPath.wslPath;
    }
}

export function getAksClusterTreeItem(commandTarget: any, cloudExplorer: API<CloudExplorerV1>): Errorable<AksClusterTreeItem> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: 'Cloud explorer is unavailable.'};
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(commandTarget) as CloudExplorerV1.CloudExplorerResourceNode;

    const isClusterTarget = cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource.nodeType === "cluster";

    if (!isClusterTarget) {
        return { succeeded: false, error: 'This command only applies to AKS clusters.'};
    }

    const cluster = cloudTarget.cloudResource as AksClusterTreeItem;
    if (cluster === undefined) {
        return { succeeded: false, error: 'Cloud target cluster resource is not of type AksClusterTreeItem.'};
    }

    return { succeeded: true, result: cluster };
}

export function getAksClusterSubscriptionItem(commandTarget: any, cloudExplorer: API<CloudExplorerV1>): Errorable<SubscriptionTreeNode> {
    if (!cloudExplorer.available) {
        return { succeeded: false, error: 'Cloud explorer is unavailable.'};
    }

    const cloudTarget = cloudExplorer.api.resolveCommandTarget(commandTarget) as CloudExplorerV1.CloudExplorerResourceNode;

    const isAKSSubscriptionTarget = cloudTarget !== undefined &&
        cloudTarget.cloudName === "Azure" &&
        cloudTarget.cloudResource.nodeType === "subscription";

    if (!isAKSSubscriptionTarget) {
        return { succeeded: false, error: 'This command only applies to AKS subscription.'};
    }

    const cloudResource = cloudTarget.cloudResource as SubscriptionTreeNode;
    if (cloudResource === undefined) {
        return { succeeded: false, error: 'Cloud target cluster resource is not of type AksClusterSubscriptionItem.'};
    }

    return { succeeded: true, result: cloudResource };
}

export async function getKubeconfigYaml(target: AksClusterTreeItem, clusterProperties: ClusterARMResponse): Promise<Errorable<string>> {
    const client = getContainerClient(target);
    return clusterProperties.properties.aadProfile ?
        getAadKubeconfig(target, client) :
        getNonAadKubeconfig(target, client);
}

async function getNonAadKubeconfig(cluster: AksClusterTreeItem, client: azcs.ContainerServiceClient): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(cluster.resourceGroupName, cluster.name);
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve user credentials for non-AAD cluster ${cluster.name}: ${e}`};
    }

    return getClusterUserKubeconfig(clusterUserCredentials, cluster.name);
}

async function getAadKubeconfig(cluster: AksClusterTreeItem, client: azcs.ContainerServiceClient): Promise<Errorable<string>> {
    let clusterUserCredentials: azcs.CredentialResults;

    try {
        // For AAD clusters, force the credentials to be in 'exec' format.
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(cluster.resourceGroupName, cluster.name, { format: azcs.KnownFormat.Exec });
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve user credentials for AAD cluster ${cluster.name}: ${e}`};
    }

    // The initial credentials contain an 'exec' section that calls kubelogin with devicecode authentication.
    const unauthenticatedKubeconfig = getClusterUserKubeconfig(clusterUserCredentials, cluster.name);
    if (failed(unauthenticatedKubeconfig)) {
        return unauthenticatedKubeconfig;
    }

    // Parse the kubeconfig YAML into an object so that we can read and update exec options.
    let kubeconfigYaml: any;
    try {
        kubeconfigYaml = yaml.load(unauthenticatedKubeconfig.result);
    } catch (e) {
        return { succeeded: false, error: `Failed to parse kubeconfig YAML for ${cluster.name}: ${e}` };
    }

    // We expect there will be just one user in the kubeconfig. Read the 'exec' arguments for it.
    const execBlock = kubeconfigYaml.users[0].user.exec;
    const execOptions = readExecOptions(execBlock.args);

    // We need to supply an access token that grants the user access to the cluster. The user running this will be authenticated,
    // and we have access to their credentials here...
    const localToken = await cluster.subscription.credentials.getToken();

    // But, the user's token is for VS Code, and instead we need a token whose audience is the AKS server ID.
    // This can be obtained by exchanging the user's refresh token for one with the new audience.
    const aadAccessToken = await getAksAadAccessToken(cluster.subscription.environment, execOptions.serverId, execOptions.tenantId, localToken.refreshToken);
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
    subcommand: string,
    environment: string,
    serverId: string,
    clientId: string,
    tenantId: string,
    loginMethod: string
}

function readExecOptions(execArgs: [string]): ExecOptions {
    // The 'exec' command args are made up of a subcommand (get-token) and a number of name/value options.
    const [subcommand, ...options] = execArgs;

    // Extract the options into an object for convenient lookup.
    // The options look like "--<name1> <value1> --<name2> <value2> ...", so we iterate through the array in steps of 2, and at each stop:
    // - extract the option name and value for that index
    // - merge them into an object that we iteratively build up
    const optionLookup: { [name: string]: string } = options.reduce((result: { [name: string]: string }, _arg: string, index: number) => {
        return index % 2 === 0 ?
            { ...result, [options[index]]: options[index+1] } :
            result;
    }, {});

    return {
        subcommand,
        environment: optionLookup["--environment"] || optionLookup["-e"],
        serverId: optionLookup["--server-id"],
        clientId: optionLookup["--client-id"],
        tenantId: optionLookup["--tenant-id"],
        loginMethod: optionLookup["--login"] || optionLookup["-l"]
    };
}

function buildExecOptionsWithCache(execOptions: ExecOptions, cacheDir: string) {
    return [
        execOptions.subcommand,
        "--environment", execOptions.environment,
        "--server-id", execOptions.serverId,
        "--client-id", execOptions.clientId,
        "--tenant-id", execOptions.tenantId,
        // Counter-intuitively, the most appropriate login-type here is 'interactive'. This will run silently with a cached credential, and
        // if the credential is missing or expired it will launch a web-browser, which is more applicable to a GUI environment than a device
        // code that needs to be copied from a command line.
        "--login", "interactive",
        "--token-cache-dir", cacheDir
    ];
}

function storeCachedAadToken(aadAccessToken: AuthenticationResult, execOptions: ExecOptions): Errorable<string> {
    // kubelogin supports an extra option '--token-cache-dir' where it expects to find cached credentials.
    // If our credential is found in there, it won't initiate an interactive login.
    // It will look for a file with a specific name based on the options supplied:
    const expectedFilename = `${execOptions.environment}-${execOptions.serverId}-${execOptions.clientId}-${execOptions.tenantId}.json`;
    const cacheDirObj = tmp.dirSync();
    const cacheFilePath = path.join(cacheDirObj.name, expectedFilename);

    const nowTimestamp = Math.floor(new Date().getTime() / 1000);
    const expiryTimestamp = aadAccessToken.expiresOn ? Math.floor(aadAccessToken.expiresOn.getTime() / 1000) : nowTimestamp;
    const cachedTokenData = {
        access_token: aadAccessToken.accessToken,
        refresh_token: "",
        expires_in: expiryTimestamp - nowTimestamp,
        expires_on: expiryTimestamp,
        not_before: 0,
        resource: execOptions.serverId,
        token_type: ""
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
        return { succeeded: false, error: `No "clusterUser" kubeconfig found for cluster ${clusterName}.`};
    }

    const kubeconfig = kubeconfigCredResult.value?.toString();
    if (kubeconfig === undefined) {
        return { succeeded: false, error: `Empty kubeconfig for cluster ${clusterName}.` };
    }

    return { succeeded: true, result: kubeconfig };
}

export async function getClusterProperties(target: AksClusterTreeItem): Promise<Errorable<ClusterARMResponse>> {
    try {
        const client = getResourceManagementClient(target);
        const clusterInfo = await client.resources.get(target.resourceGroupName, target.resourceType, "", "", target.name, "2022-02-01");

        return { succeeded: true, result: <ClusterARMResponse>clusterInfo };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${target.name} managed cluster: ${ex}` };
    }
}

export async function determineClusterState(
    target: AksClusterTreeItem,
    clusterName: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);
        const clusterInfo = (await containerClient.managedClusters.get(target.resourceGroupName, clusterName));

        if ( clusterInfo.provisioningState !== "Stopping" && clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerState?.code === "Stopped") ) {
            return { succeeded: true, result: ClusterStartStopState.Stopped };
        } else if ( clusterInfo.provisioningState === "Succeeded" && clusterInfo.agentPoolProfiles?.every((nodePool) => nodePool.powerState?.code === "Running") ) {
            return { succeeded: true, result: ClusterStartStopState.Started };
        } else if (clusterInfo.provisioningState === "Stopping") {
            return { succeeded: true, result:  ClusterStartStopState.Stopping };
        } else {
            return { succeeded: true, result:  ClusterStartStopState.Starting };
        }

    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${ex}` };
    }
}

export async function startCluster(
    target: AksClusterTreeItem,
    clusterName: string,
    clusterState: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);

        if (clusterState === ClusterStartStopState.Stopped ) {
            containerClient.managedClusters.beginStartAndWait(target.resourceGroupName, clusterName, undefined);
        } else if ( clusterState === ClusterStartStopState.Stopping) {
            return { succeeded: false, error: `Cluster ${clusterName} is in Stopping state wait until cluster is fully stopped.` };
        } else {
            return { succeeded: false, error: `Cluster ${clusterName} is already Started.` };
        }

        return { succeeded: true, result: "Start cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${ex}` };
    }
}

export async function stopCluster(
    target: AksClusterTreeItem,
    clusterName: string,
    clusterState: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);

        if (clusterState === ClusterStartStopState.Started) {
            containerClient.managedClusters.beginStopAndWait(target.resourceGroupName, clusterName, undefined);
        }  else {
            return { succeeded: false, error: `Cluster ${clusterName} is either Stopped or in Stopping state.` };
        }

        return { succeeded: true, result: "Stop cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${ex}` };
    }
}

export async function getWindowsNodePoolKubernetesVersions(
    containerClient: azcs.ContainerServiceClient,
    resourceGroupName: string,
    clusterName: string
): Promise<Errorable<string[]>> {
    try {
        const k8sVersions: string[] = [];
        for await (let page of containerClient.agentPools.list(resourceGroupName, clusterName).byPage()) {
            for (const nodePool of page) {
                if (!nodePool.osType) {
                    return { succeeded: false, error: `OS type not available for node pool ${nodePool.name} for cluster ${clusterName}` };
                }
    
                if (nodePool.osType.toUpperCase() === "WINDOWS") {
                    if (!nodePool.currentOrchestratorVersion) {
                        return { succeeded: false, error: `Kubernetes version not available for node pool ${nodePool.name} for cluster ${clusterName}` };
                    }

                    k8sVersions.push(nodePool.currentOrchestratorVersion);
                }
            }
        }

        return { succeeded: true, result: k8sVersions };
    } catch (ex) {
        return { succeeded: false, error: `Error retrieving Windows node pool Kubernetes versions for ${clusterName}: ${ex}` };
    }
}

export function getContainerClient(target: AksClusterTreeItem | SubscriptionTreeItem): azcs.ContainerServiceClient {
    const environment = target.subscription.environment;
    return new azcs.ContainerServiceClient(target.subscription.credentials, target.subscription.subscriptionId, {endpoint: environment.resourceManagerEndpointUrl});
}

export function getResourceManagementClient(target: AksClusterTreeItem | SubscriptionTreeItem): ResourceManagementClient {
    const environment = target.subscription.environment;
    return new ResourceManagementClient(target.subscription.credentials, target.subscription.subscriptionId!, {endpoint: environment.resourceManagerEndpointUrl});
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

export async function deleteCluster(
    target: AksClusterTreeItem,
    clusterName: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);
        await containerClient.managedClusters.beginDeleteAndWait(target.resourceGroupName, clusterName)

        return { succeeded: true, result: "Delete cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}` };
    }
}

export async function abortLastOperationInCluster(
    target: AksClusterTreeItem,
    clusterName: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);
        await containerClient.managedClusters.beginAbortLatestOperationAndWait(target.resourceGroupName, clusterName)

        return { succeeded: true, result: "Abort last operation in cluster succeeded." };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}` };
    }
}

export async function rotateClusterCert(
    target: AksClusterTreeItem,
    clusterName: string
): Promise<Errorable<string>> {
    try {
        const containerClient = getContainerClient(target);
        await containerClient.managedClusters.beginRotateClusterCertificatesAndWait(target.resourceGroupName, clusterName);

        return { succeeded: true, result: `Rotate cluster certificate for ${clusterName} succeeded.` };
    } catch (ex) {
        return { succeeded: false, error: `Error invoking ${clusterName} managed cluster: ${getErrorMessage(ex)}` };
    }
}