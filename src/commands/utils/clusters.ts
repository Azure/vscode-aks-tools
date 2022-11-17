import { API, CloudExplorerV1 } from 'vscode-kubernetes-tools-api';
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import * as azcs from '@azure/arm-containerservice';
import { Errorable, failed } from './errorable';
import { ResourceManagementClient } from '@azure/arm-resources';
import { SubscriptionTreeNode } from '../../tree/subscriptionTreeItem';
import { getAksAadAccessToken } from './authProvider';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { getCloud, PublicCloud } from './clouds';
import { AuthenticationResult } from '@azure/msal-node';
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
        clusterUserCredentials = await client.managedClusters.listClusterUserCredentials(cluster.resourceGroupName, cluster.name, { format: azcs.KnownFormat.Exec });
    } catch (e) {
        return { succeeded: false, error: `Failed to retrieve user credentials for AAD cluster ${cluster.name}: ${e}`};
    }

    // The initial credentials contain an 'exec' section that calls kubelogin with devicecode authentication.
    const unauthenticatedKubeconfig = getClusterUserKubeconfig(clusterUserCredentials, cluster.name);
    if (failed(unauthenticatedKubeconfig)) {
        return unauthenticatedKubeconfig;
    }

    let kubeconfigYaml: any;
    try {
        kubeconfigYaml = yaml.load(unauthenticatedKubeconfig.result);
    } catch (e) {
        return { succeeded: false, error: `Failed to parse kubeconfig YAML for ${cluster.name}: ${e}` };
    }

    // We expect there will be just one user in the kubeconfig. Read the 'exec' arguments for it.
    const execBlock = kubeconfigYaml.users[0].user.exec;
    const execOptions = readExecOptions(execBlock.args);

    // Get a token to store in the cached credentials directory.
    const localToken = await cluster.subscription.credentials.getToken();
    const cloud = getCloud(cluster);
    if (failed(cloud)) {
        return cloud;
    }

    const aadAccessToken = await getAksAadAccessToken(cloud.result, execOptions.serverId, localToken.refreshToken);
    if (failed(aadAccessToken)) {
        return aadAccessToken;
    }

    const cacheDir = storeCachedAadToken(aadAccessToken.result, execOptions);
    if (failed(cacheDir)) {
        return cacheDir;
    }

    // Update the kubeconfig YAML.
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
        // In a non-interactive environment, 'devicecode' login now returns an error, see https://github.com/Azure/kubelogin/pull/145.
        // Very counter-intuitively, 'interactive' login returns successfully here (and is not interactive because of the cached credential).
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
        const client = new ResourceManagementClient(target.subscription.credentials, target.subscription.subscriptionId, { noRetryPolicy: true });
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

export function getContainerClient(target: AksClusterTreeItem): azcs.ContainerServiceClient {
    const cloudResult = getCloud(target);
    const cloud = failed(cloudResult) ? PublicCloud : cloudResult.result;
    return new azcs.ContainerServiceClient(target.subscription.credentials, target.subscription.subscriptionId, {endpoint: cloud.armEndpoint});
}