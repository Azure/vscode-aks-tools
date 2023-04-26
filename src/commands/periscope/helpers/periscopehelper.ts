import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { getSASKey, LinkDuration } from '../../utils/azurestorage';
import { parseResource } from '../../../azure-api-utils';
import * as ast from '@azure/arm-storage';
import { PeriscopeStorage, PodLogs, UploadStatus } from '../models/storage';
import * as amon from '@azure/arm-monitor';
import * as path from 'path';
import * as fs from 'fs';
import * as semver from 'semver';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';
import { combine, Errorable, failed } from '../../utils/errorable';
import { invokeKubectlCommand } from '../../utils/kubectl';
import { KustomizeConfig } from '../models/config';
import { ClusterFeatures } from '../models/clusterFeatures';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { getWindowsNodePoolKubernetesVersions } from '../../utils/clusters';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
const tmp = require('tmp');

export async function getClusterDiagnosticSettings(
    cluster: AksClusterTreeItem
): Promise<amon.MonitorManagementModels.DiagnosticSettingsCategoryResourceCollection | undefined> {
    try {
        // Get daignostic setting via diagnostic monitor
        const diagnosticMonitor = new amon.MonitorManagementClient(cluster.subscription.credentials, cluster.subscription.subscriptionId);
        const diagnosticSettings = await diagnosticMonitor.diagnosticSettings.list(cluster.id!);

        return diagnosticSettings;
    } catch (e) {
        vscode.window.showErrorMessage(`Error fetching cluster diagnostic monitor: ${e}`);
        return undefined;
    }
}

export async function chooseStorageAccount(
    diagnosticSettings: amon.MonitorManagementModels.DiagnosticSettingsResourceCollection,
): Promise<string | void> {
    /*
        Check the diagnostic setting is 1 or more than 1:
          1. For the scenario of 1 storage account in diagnostic settings - Pick the storageId resource and get SAS.
          2. For the scenario for more than 1 then show VsCode quickPick to select and get SAS of selected.
    */
    if (!diagnosticSettings || !diagnosticSettings.value) return undefined;

    if (diagnosticSettings.value.length === 1) {
        // In case of only one storage account associated, use the one (1) as default storage account and no UI will be displayed.
        const selectedStorageAccount = diagnosticSettings.value![0].storageAccountId!;
        return selectedStorageAccount;
    }

    const storageAccountNameToStorageIdArray: { id: string; label: string; }[] = [];

    diagnosticSettings.value?.forEach((item) => {
        if (item.storageAccountId) {
            const { name } = parseResource(item.storageAccountId!);
            if (!name) {
                vscode.window.showInformationMessage(`Storage Id is malformed: ${item.storageAccountId}`);
                return;
            }
            storageAccountNameToStorageIdArray.push({ id: item.storageAccountId, label: name });
        }
    });

    // accounts is now an array of {id, name}
    const accountQuickPicks = storageAccountNameToStorageIdArray;

    // Create quick pick for more than 1 storage account scenario.
    const selectedQuickPick = await vscode.window.showQuickPick(
        accountQuickPicks,
        {
            placeHolder: "Select storage account for Periscope deployment:",
            ignoreFocusOut: true
        });

    if (selectedQuickPick) {
        return selectedQuickPick.id;
    }

}

export async function getStorageInfo(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    cluster: AksClusterTreeItem,
    diagnosticStorageAccountId: string,
    clusterKubeConfig: string
): Promise<Errorable<PeriscopeStorage>> {
    try {
        const { resourceGroupName, name: accountName } = parseResource(diagnosticStorageAccountId);

        if (!resourceGroupName || !accountName) {
            return { succeeded: false, error: `Invalid storage id ${diagnosticStorageAccountId} associated with the cluster` };
        }

        // Get keys from storage client.
        const storageClient = new ast.StorageManagementClient(cluster.subscription.credentials, cluster.subscription.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        const storageKey = storageAccKeyList.keys?.find((it) => it.keyName === "key1")?.value!;

        const acctProperties = await storageClient.storageAccounts.getProperties(resourceGroupName, accountName);
        const blobEndpoint = acctProperties.primaryEndpoints?.blob;
        if (blobEndpoint === undefined) {
            return { succeeded: false, error: "Unable to retrieve blob endpoint from storage account." };
        }

        // Get container name from cluster-info default behaviour was APIServerName without
        const containerName = await extractContainerName(kubectl, clusterKubeConfig);
        if (failed(containerName)) return containerName;

        const clusterStorageInfo = {
            containerName: containerName.result,
            storageName: accountName,
            storageKey: storageKey,
            blobEndpoint,
            storageDeploymentSas: getSASKey(accountName, storageKey, LinkDuration.DownloadNow),
            sevenDaysSasKey: getSASKey(accountName, storageKey, LinkDuration.Shareable)
        };

        return { succeeded: true, result: clusterStorageInfo };
    } catch (e) {
        return { succeeded: false, error: `Storage associated with cluster had following error: ${e}` };
    }
}

export async function prepareAKSPeriscopeKustomizeOverlay(
    clusterStorageInfo: PeriscopeStorage,
    kustomizeConfig: KustomizeConfig,
    clusterFeatures: ClusterFeatures,
    runId: string
): Promise<Errorable<string>> {
    const kustomizeDirObj = tmp.dirSync();
    const kustomizeFile = path.join(kustomizeDirObj.name, "kustomization.yaml");

    // Build the list of components to include in the Kustomize overlay spec based on cluster features.
    let components = "components:\n";
    if ((clusterFeatures & ClusterFeatures.WindowsHpc) === ClusterFeatures.WindowsHpc) {
        // The Windows HPC component is only supported in Periscope 0.0.10 and higher.
        if (semver.parse(kustomizeConfig.imageVersion) && semver.gte(kustomizeConfig.imageVersion, "0.0.10")) {
            components += `- https://github.com/${kustomizeConfig.repoOrg}/aks-periscope//deployment/components/win-hpc?ref=${kustomizeConfig.releaseTag}\n`;
        }
    }

    // From 0.0.13 onwards, the image names are the same for Windows and Linux. Discussion linked to PR here:
    // https://github.com/Azure/aks-periscope/pull/212
    // Previously the Windows image was named 'periscope-win'.
    let windowsImageName = "periscope";
    if (semver.parse(kustomizeConfig.imageVersion) && semver.lt(kustomizeConfig.imageVersion, "0.0.13")) {
        windowsImageName = "periscope-win";
    }

    // Build a Kustomize overlay referencing a base for a known release, and using the images from MCR
    // for that release.
    const kustomizeContent = `
resources:
- https://github.com/${kustomizeConfig.repoOrg}/aks-periscope//deployment/base?ref=${kustomizeConfig.releaseTag}

${components}

images:
- name: periscope-linux
  newName: ${kustomizeConfig.containerRegistry}/aks/periscope
  newTag: "${kustomizeConfig.imageVersion}"
- name: periscope-windows
  newName: ${kustomizeConfig.containerRegistry}/aks/${windowsImageName}
  newTag: "${kustomizeConfig.imageVersion}"

secretGenerator:
- name: azureblob-secret
  behavior: replace
  literals:
  - AZURE_BLOB_ACCOUNT_NAME=${clusterStorageInfo.storageName}
  - AZURE_BLOB_SAS_KEY=${clusterStorageInfo.storageDeploymentSas}
  - AZURE_BLOB_CONTAINER_NAME=${clusterStorageInfo.containerName}

configMapGenerator:
- name: diagnostic-config
  behavior: merge
  literals:
  - DIAGNOSTIC_RUN_ID=${runId}
`;

    try {
        fs.writeFileSync(kustomizeFile, kustomizeContent);
        return { succeeded: true, result: kustomizeDirObj.name };
    } catch (e) {
        return { succeeded: false, error: `Unable to save ${kustomizeFile}: ${e}` };
    }
}

export async function getNodeNames(kubectl: k8s.APIAvailable<k8s.KubectlV1>, clusterKubeConfig: string): Promise<Errorable<string[]>> {
    const runCommandResult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
        clusterKubeConfig,
        "YAML",
        (kubeConfigFile) => invokeKubectlCommand(kubectl, kubeConfigFile, 'get node -o jsonpath="{.items[*].metadata.name}"'));

    if (failed(runCommandResult)) return runCommandResult;

    return { succeeded: true, result: runCommandResult.result.stdout.split(' ') };
}

export async function checkUploadStatus(
    periscopeStorage: PeriscopeStorage,
    runId: string,
    nodeNames: string[]
): Promise<UploadStatus[]> {
    const storageAccount = periscopeStorage.storageName;
    const storageKey = periscopeStorage.storageKey;

    // Use SharedKeyCredential with storage account and account key
    const sharedKeyCredential = new StorageSharedKeyCredential(storageAccount, storageKey);

    const blobServiceClient = new BlobServiceClient(
        periscopeStorage.blobEndpoint,
        sharedKeyCredential
    );

    const uploadStatuses = [];

    const containerClient = blobServiceClient.getContainerClient(periscopeStorage.containerName);
    for (const nodeName of nodeNames) {
        const blobName = `${runId}/${nodeName}/${nodeName}.zip`;
        const blobClient = containerClient.getBlobClient(blobName);
        const isUploaded = await blobClient.exists();
        uploadStatuses.push({nodeName, isUploaded});
    }

    return uploadStatuses;
}

export async function getNodeLogs(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    clusterKubeConfig: string,
    periscopeNamespace: string,
    nodeName: string
): Promise<Errorable<PodLogs[]>> {
    const getPodsCommand =
        `get pods -n ${periscopeNamespace} --field-selector "spec.nodeName=${nodeName}" -o jsonpath="{.items[*].metadata.name}"`;

    // Run kubectl commands in parallel to gather some output about cluster features.
    return await tmpfile.withOptionalTempFile<Errorable<PodLogs[]>>(clusterKubeConfig, "YAML", async (kubeConfigFile) => {
        const getPodsResult = await invokeKubectlCommand(kubectl, kubeConfigFile, getPodsCommand);
        if (failed(getPodsResult)) {
            return getPodsResult;
        }

        const podNames = getPodsResult.result.stdout.split(' ');

        const podLogsResults = await Promise.all(podNames.map(getPodLogs));
        const podLogs = combine(podLogsResults);
        if (failed(podLogs)) {
            return podLogs;
        }

        return { succeeded: true, result: podLogs.result };

        async function getPodLogs(podName: string): Promise<Errorable<PodLogs>> {
            const cmd = `logs -n ${periscopeNamespace} ${podName}`;
            const cmdResult = await invokeKubectlCommand(kubectl, kubeConfigFile, cmd);
            if (failed(cmdResult)) {
                return cmdResult;
            }

            const result = { podName, logs: cmdResult.result.stdout };
            return { succeeded: true, result };
        }
    });
}

async function extractContainerName(kubectl: k8s.APIAvailable<k8s.KubectlV1>, clusterKubeConfig: string): Promise<Errorable<string>> {
    const runCommandResult = await getClusterInfo(kubectl, clusterKubeConfig);
    if (failed(runCommandResult)) return runCommandResult;

    const hostNameResult = await getHostName(runCommandResult.result);
    if (failed(hostNameResult)) return hostNameResult;

    let containerName: string;

    // Form containerName from FQDN hence "-hcp-"" aka standard aks cluster vs "privatelink.<region>.azmk8s.io" private cluster.
    // https://docs.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata#container-names
    const maxContainerNameLength = 63;
    const normalisedContainerName = hostNameResult.result.replace(".", "-");
    let lenContainerName = normalisedContainerName.indexOf("-hcp-");
    if (lenContainerName === -1) {
        lenContainerName = maxContainerNameLength;
    }
    containerName = hostNameResult.result.substr(0, lenContainerName);

    return { succeeded: true, result: containerName };
}

async function getClusterInfo(kubectl: k8s.APIAvailable<k8s.KubectlV1>, clusterKubeConfig: string): Promise<Errorable<string>> {
    // Run cluster-info to get DNS Core hostname.
    const runCommandResult = await tmpfile.withOptionalTempFile<Errorable<k8s.KubectlV1.ShellResult>>(
        clusterKubeConfig,
        "YAML",
        (kubeConfigFile) => invokeKubectlCommand(kubectl, kubeConfigFile, 'cluster-info'));

    if (failed(runCommandResult)) return runCommandResult;

    return { succeeded: true, result: runCommandResult.result.stdout };
}

function getHostName(output: string): Errorable<string> {

    // Get DNS Core hostname which Periscope use it as name of the container.
    // Doc: https://kubernetes.io/docs/tasks/access-application-cluster/access-cluster/#discovering-builtin-services
    const matches = output.match(/(https?:\/\/[^\s]+)/g);
    if (matches === null) {
        return { succeeded: false, error: 'Extract container name failed with no match.' };
    }

    let hostName: string;
    if (matches.length > 0 && matches[0].indexOf('://') !== -1) {
        hostName = matches[0].replace('https://', '').split('.')[0];
    } else {
        return { succeeded: false, error: 'Cluster-Info contains no host name.' };
    }

    return { succeeded: true, result: hostName };
}

export async function getClusterFeatures(
    containerClient: ContainerServiceClient,
    resourceGroupName: string,
    clusterName: string
): Promise<Errorable<ClusterFeatures>> {
    const windowsNodePoolK8sVersions = await getWindowsNodePoolKubernetesVersions(containerClient, resourceGroupName, clusterName);
    if (failed(windowsNodePoolK8sVersions)) return windowsNodePoolK8sVersions;

    // Build the feature list.
    let features = ClusterFeatures.None;
    if (isWindowsHcpSupported(windowsNodePoolK8sVersions.result)) {
        features |= ClusterFeatures.WindowsHpc;
    }

    return { succeeded: true, result: features };
}

function isWindowsHcpSupported(windowsNodePoolKubernetesVersions: string[]): boolean {
    // If there are no Windows node pools there is no point in enabling this component
    if (windowsNodePoolKubernetesVersions.length === 0) {
        return false;
    }

    // Strictly speaking, whether host-process containers are supported in a Windows node pool depends on:
    // - Kubernetes version of the node pool (must be >= 1.23)
    // - The container runtime of the node pool (must be containerd, and version >= 1.6)
    // see: https://docs.microsoft.com/en-us/azure/aks/use-windows-hpc#limitations
    // However, for simplicity and ease of maintenance we only check the K8s version here.
    // Justification: the number of users who are on a supported K8s version but unsupported container runtime
    // is small, and will continue to decrease as users upgrade.
    for (const version of windowsNodePoolKubernetesVersions) {
        // To use this feature, *all* Windows node pools must support HPC. In other words,
        // if *any* of them have a Kuberenetes version below 1.23 we return false.
        if (semver.lt(version, "1.23.0")) {
            return false;
        }
    }

    return true;
}
