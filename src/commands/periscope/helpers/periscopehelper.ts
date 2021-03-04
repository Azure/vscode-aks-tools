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
import * as axios from 'axios';
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
    diagnosticStorageAccountId: string
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

        const clusterStorageInfo = {
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
        const response = await axios.default.get('https://raw.githubusercontent.com/Azure/aks-periscope/master/deployment/aks-periscope.yaml');
        fs.writeFileSync(tempFile.name, response.data);
        replaceDeploymentAccountNameAndSas(clusterStorageInfo, tempFile.name);
        return tempFile.name;
    } catch (e) {
        vscode.window.showErrorMessage(`Periscope Deployment file had following error: ${e}`);
        return undefined;
    }
}

function replaceDeploymentAccountNameAndSas(
    periscopeStorageInfo: PeriscopeStorage,
    aksPeriscopeFilePath: string
) {
    // persicope file is written now, replace the acc name and keys.
    const replace = require("replace");

    const base64Name = Buffer.from(periscopeStorageInfo.storageName).toString('base64');
    const base64Sas = Buffer.from(periscopeStorageInfo.storageDeploymentSas).toString('base64');
    replace({
        regex: "# <accountName, base64 encoded>",
        replacement: `"${base64Name}"`,
        paths: [aksPeriscopeFilePath],
        recursive: false,
        silent: true,
    });

    replace({
        regex: "# <saskey, base64 encoded>",
        replacement: `"${base64Sas}"`,
        paths: [aksPeriscopeFilePath],
        recursive: false,
        silent: true,
    });
}

export async function generateDownloadableLinks(
    periscopeStorage: PeriscopeStorage,
    output: string
): Promise<PeriscopeHTMLInterface[] | undefined> {

    try {
        const storageAccount = periscopeStorage.storageName;
        const storageKey = periscopeStorage.storageKey;
        const sas = periscopeStorage.storageDeploymentSas;
        const sevenDaySas = periscopeStorage.sevenDaysSasKey;

        // Get DNS Core hostname which Periscope use it as name of the container.
        const matches = output.match(/(https?:\/\/[^\s]+)/g);
        let containerName;
        if (matches![0].indexOf('://') !== -1) {
            containerName = matches![0].replace('https://', '').split('.')[0];
        }

        // Use SharedKeyCredential with storage account and account key
        const sharedKeyCredential = new StorageSharedKeyCredential(storageAccount, storageKey);
        const blobServiceClient = new BlobServiceClient(
            `https://${storageAccount}.blob.core.windows.net`,
            sharedKeyCredential
        );

        // Hide this all under single pupose funct which lik elike : getZipDir or get me dirname
        const containerClient = blobServiceClient.getContainerClient(containerName);

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