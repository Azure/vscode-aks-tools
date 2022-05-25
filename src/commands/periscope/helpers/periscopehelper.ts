import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { getSASKey, LinkDuration } from '../../utils/azurestorage';
import { parseResource } from '../../../azure-api-utils';
import * as ast from '@azure/arm-storage';
import { PeriscopeStorage, PeriscopeHTMLInterface } from '../models/storage';
import * as amon from '@azure/arm-monitor';
import * as path from 'path';
import * as fs from 'fs';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';
import { getRenderedContent, getResourceUri } from '../../utils/webviews';
import { Errorable, failed } from '../../utils/errorable';
import { invokeKubectlCommand } from '../../utils/kubectl';
import { KustomizeConfig } from '../models/kustomizeConfig';
const tmp = require('tmp');

const {
    BlobServiceClient,
    StorageSharedKeyCredential
} = require("@azure/storage-blob");

export async function getClusterDiagnosticSettings(
    cluster: AksClusterTreeItem
): Promise<amon.MonitorManagementModels.DiagnosticSettingsCategoryResourceCollection | undefined> {
    try {
        // Get daignostic setting via diagnostic monitor
        const diagnosticMonitor = new amon.MonitorManagementClient(cluster.root.credentials, cluster.root.subscriptionId);
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
        const storageClient = new ast.StorageManagementClient(cluster.root.credentials, cluster.root.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        const storageKey = storageAccKeyList.keys?.find((it) => it.keyName === "key1")?.value!;

        // Get container name from cluster-info default behaviour was APIServerName without
        const containerName = await extractContainerName(kubectl, clusterKubeConfig);
        if (failed(containerName)) return containerName;

        const clusterStorageInfo = {
            containerName: containerName.result,
            storageName: accountName,
            storageKey: storageKey,
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
    kustomizeConfig: KustomizeConfig
): Promise<Errorable<string>> {
    const kustomizeDirObj = tmp.dirSync();
    const kustomizeFile = path.join(kustomizeDirObj.name, "kustomization.yaml");

    // Build a Kustomize overlay referencing a base for a known release, and using the images from MCR
    // for that release.
    const kustomizeContent = `
resources:
- https://github.com/${kustomizeConfig.repoOrg}/aks-periscope//deployment/base?ref=${kustomizeConfig.releaseTag}

images:
- name: periscope-linux
  newName: ${kustomizeConfig.containerRegistry}/aks/periscope
  newTag: "${kustomizeConfig.imageVersion}"
- name: periscope-windows
  newName: ${kustomizeConfig.containerRegistry}/aks/periscope-win
  newTag: "${kustomizeConfig.imageVersion}"

secretGenerator:
- name: azureblob-secret
  behavior: replace
  literals:
  - AZURE_BLOB_ACCOUNT_NAME=${clusterStorageInfo.storageName}
  - AZURE_BLOB_SAS_KEY=${clusterStorageInfo.storageDeploymentSas}
  - AZURE_BLOB_CONTAINER_NAME=${clusterStorageInfo.containerName}
`;

    try {
        fs.writeFileSync(kustomizeFile, kustomizeContent);
        return { succeeded: true, result: kustomizeDirObj.name };
    } catch (e) {
        return { succeeded: false, error: `Unable to save ${kustomizeFile}: ${e}` };
    }
}

export async function generateDownloadableLinks(
    periscopeStorage: PeriscopeStorage
): Promise<PeriscopeHTMLInterface[] | undefined> {

    try {
        const storageAccount = periscopeStorage.storageName;
        const storageKey = periscopeStorage.storageKey;
        const sas = periscopeStorage.storageDeploymentSas;
        const sevenDaySas = periscopeStorage.sevenDaysSasKey;

        // Use SharedKeyCredential with storage account and account key
        const sharedKeyCredential = new StorageSharedKeyCredential(storageAccount, storageKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${storageAccount}.blob.core.windows.net`,
            sharedKeyCredential
        );

        // Hide this all under single pupose funct which lik elike : getZipDir or get me dirname
        const containerClient = blobServiceClient.getContainerClient(periscopeStorage.containerName);

        // List all current blob.
        const listCurrentUploadedFolders = [];
        for await (const item of containerClient.listBlobsByHierarchy("/")) {
            if (item.kind === "prefix") {
                listCurrentUploadedFolders.push(item.name);
            }
        }

        // Sort and get the latest uploaded folder under the container used by periscope.
        const periscopeHtmlInterfaceList = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            // Get the latest uploaded folder, then Identify the Zip files in the latest uploaded logs within that folder
            // and extract *.zip files which are individual node logs.
            const latestBlobUploadedByPeriscope = blob.name.indexOf(listCurrentUploadedFolders.sort().reverse()[0]);

            if (latestBlobUploadedByPeriscope !== -1 && blob.name.indexOf('.zip') !== -1) {
                const periscopeHTMLInterface = {
                    storageTimeStamp: path.parse(blob.name).dir.split('/')[0],
                    nodeLogFileName: path.parse(blob.name).name,
                    downloadableZipFilename: `${path.parse(blob.name).name}-downloadable`,
                    downloadableZipUrl: `${containerClient.url}/${blob.name}${sas}`,
                    downloadableZipShareFilename: `${path.parse(blob.name).name}-share`,
                    downloadableZipShareUrl: `${containerClient.url}/${blob.name}${sevenDaySas}`
                };

                periscopeHtmlInterfaceList.push(periscopeHTMLInterface);
            }
        }
        return periscopeHtmlInterfaceList;
    } catch (e) {
        vscode.window.showErrorMessage(`Error generating downloadable link: ${e}`);
        return undefined;
    }
}

export function getWebviewContent(
    clustername: string,
    aksExtensionPath: string,
    output: k8s.KubectlV1.ShellResult | undefined,
    periscopeStorageInfo: PeriscopeStorage | undefined,
    downloadAndShareNodeLogsList: PeriscopeHTMLInterface[] | undefined,
    hasDiagnosticSettings = true
): string {
    const styleUri = getResourceUri(aksExtensionPath, 'periscope', 'periscope.css');
    const templateUri = getResourceUri(aksExtensionPath, 'periscope', 'periscope.html');

    const commandOutput = output ? output.stderr + output.stdout : undefined;
    const data = {
        cssuri: styleUri,
        storageAccName: periscopeStorageInfo?.storageName,
        name: clustername,
        output: commandOutput,
        outputCode: output?.code,
        downloadAndShareNodeLogsList: downloadAndShareNodeLogsList,
        noDiagnosticSettings: !hasDiagnosticSettings,
    };
  
    return getRenderedContent(templateUri, data);
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
        kubeConfigFile => invokeKubectlCommand(kubectl, kubeConfigFile, 'cluster-info'));
    
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