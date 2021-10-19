import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { getSASKey, LinkDuration } from '../../utils/azurestorage';
import { parseResource } from '../../../azure-api-utils';
import * as ast from '@azure/arm-storage';
import { PeriscopeStorage, PeriscopeHTMLInterface } from '../models/storage';
import * as amon from '@azure/arm-monitor';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';
import AksClusterTreeItem from '../../../tree/aksClusterTreeItem';
import * as tmpfile from '../../utils/tempfile';
import { getExtensionPath } from '../../utils/host';
import { ok, err, Result } from 'neverthrow';
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
    cluster: AksClusterTreeItem,
    diagnosticStorageAccountId: string,
    clusterKubeConfig: string
): Promise<PeriscopeStorage | undefined> {
    try {
        const { resourceGroupName, name: accountName } = parseResource(diagnosticStorageAccountId);

        if (!resourceGroupName || !accountName) {
            vscode.window.showErrorMessage(`Invalid storage id ${diagnosticStorageAccountId} associated with the cluster`);
            return undefined;
        }

        // Get keys from storage client.
        const storageClient = new ast.StorageManagementClient(cluster.root.credentials, cluster.root.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        const storageKey = storageAccKeyList.keys?.find((it) => it.keyName === "key1")?.value!;

        // Get container name from cluster-info default behaviour was APIServerName without
        const containerName = await extractContainerName(clusterKubeConfig);
        if (!containerName ) return undefined;

        const clusterStorageInfo = {
            containerName: containerName,
            storageName: accountName,
            storageKey: storageKey,
            storageDeploymentSas: getSASKey(accountName, storageKey, LinkDuration.DownloadNow),
            sevenDaysSasKey: getSASKey(accountName, storageKey, LinkDuration.Shareable)
        };

        return clusterStorageInfo;
    } catch (e) {
        vscode.window.showErrorMessage(`Storage associated with cluster had following error: ${e}`);
        return undefined;
    }
}

export async function prepareAKSPeriscopeDeploymetFile(
    clusterStorageInfo: PeriscopeStorage
): Promise<string | undefined> {
    const tempFile = tmp.fileSync({ prefix: "aks-periscope-", postfix: `.yaml` });

    try {
        const extensionPath = getExtensionPath();
        const yamlPathOnDisk = vscode.Uri.file(path.join(extensionPath!, 'resources', 'yaml', 'aks-periscope.yaml'));
        const base64Sas = Buffer.from(clusterStorageInfo.storageDeploymentSas).toString('base64');

        const deploymentContent = fs.readFileSync(yamlPathOnDisk.fsPath, 'utf8')
            .replace("# <saskey, base64 encoded>", base64Sas)
            .replace("# <accountName, string>", clusterStorageInfo.storageName)
            .replace("# <containerName, string>", clusterStorageInfo.containerName);
        fs.writeFileSync(tempFile.name, deploymentContent);

        return tempFile.name;
    } catch (e) {
        vscode.window.showErrorMessage(`Periscope Deployment file had following error: ${e}`);
        return undefined;
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
    const stylePathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(aksExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const commandOutput = output ? output.stderr + output.stdout : undefined;

    htmlHandlerRegisterHelper();
    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        storageAccName: periscopeStorageInfo?.storageName,
        name: clustername,
        output: commandOutput,
        outputCode: output?.code,
        downloadAndShareNodeLogsList: downloadAndShareNodeLogsList,
        noDiagnosticSettings: !hasDiagnosticSettings,
    };
    const webviewcontent = template(data);

    return webviewcontent;
}

export function htmlHandlerRegisterHelper() {
    htmlhandlers.registerHelper("equalsZero", equalsZero);
    htmlhandlers.registerHelper("isNonZeroNumber", isNonZeroNumber);
}

function equalsZero(value: number): boolean {
    return value === 0;
}

function isNonZeroNumber(value: any): boolean {
    if (isNaN(Number(value))) {
        return false;
    }
    return value !== 0;
}

async function extractContainerName(clusterKubeConfig: string): Promise<string | undefined> {
    const runCommandResult = await getClusterInfo(clusterKubeConfig);
    if (runCommandResult.isErr()) {
        vscode.window.showErrorMessage(runCommandResult.error.message);
        return undefined;
    }

    const hostNameResult = await getHostName(runCommandResult.value);
    if (hostNameResult.isErr()) {
        vscode.window.showErrorMessage(hostNameResult.error.message);
        return undefined;
    }
    let containerName: string;

    // Form containerName from FQDN hence "-hcp-"" aka standard aks cluster vs "privatelink.<region>.azmk8s.io" private cluster.
    // https://docs.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata#container-names
    const maxContainerNameLength = 63;
    const normalisedContainerName = hostNameResult.value.replace(".", "-");
    let lenContainerName = normalisedContainerName.indexOf("-hcp-");
    if (lenContainerName === -1) {
        lenContainerName = maxContainerNameLength;
    }
    containerName = hostNameResult.value.substr(0, lenContainerName);

    return containerName;
}

async function getClusterInfo(clusterKubeConfig: string): Promise<Result<string, Error>> {
    const kubectl = await k8s.extension.kubectl.v1;

    if (!kubectl.available) {
        return err(Error(`Kubectl is unavailable.`));
    }

    // Run cluster-info to get DNS Core hostname.
    const runCommandResult = await tmpfile.withOptionalTempFile<k8s.KubectlV1.ShellResult | undefined>(
        clusterKubeConfig, "YAML",
        (f) => kubectl.api.invokeCommand(`cluster-info --kubeconfig="${f}"`)
    );

    if (runCommandResult === undefined) {
        return err(Error(`Cluster-info failed with ${runCommandResult} error.`));
    } else if (runCommandResult.code !== 0) {
        return err(Error(`Get cluster-info failed with exit code ${runCommandResult.code} and error: ${runCommandResult.stderr}`));
    }

    return ok(runCommandResult.stdout);
}

async function getHostName(output: string): Promise<Result<string, Error>> {

    // Get DNS Core hostname which Periscope use it as name of the container.
    // Doc: https://kubernetes.io/docs/tasks/access-application-cluster/access-cluster/#discovering-builtin-services
    const matches = output.match(/(https?:\/\/[^\s]+)/g);
    if (matches === null) {
        return err(Error(`Extract container name failed with no match.`));
    }

    let hostName: string;
    if (matches.length > 0 && matches[0].indexOf('://') !== -1) {
        hostName = matches[0].replace('https://', '').split('.')[0];
    } else {
        return err(new Error(`Cluster-Info contains no host name.`));
    }

    return ok(hostName);

}