import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { getSASKey, SASExpiryTime } from '../../utils/azurestorage';
import { parseResource } from '../../../azure-api-utils';
import * as ast from 'azure-arm-storage';
import { PeriscopeStorage, PeriscopeHTMLInterface } from '../models/storage';
import * as amon from 'azure-arm-monitor';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';

const {
    BlobServiceClient,
    StorageSharedKeyCredential
} = require("@azure/storage-blob");

export async function getClusterDiagnosticSettings(
    target: k8s.CloudExplorerV1.CloudExplorerResourceNode
): Promise<amon.MonitorManagementModels.DiagnosticSettingsCategoryResourceCollection | undefined> {
    try {
        // Get daignostic setting via diagnostic monitor
        const cloudResource = target.cloudResource;
        const diagnosticMonitor = new amon.MonitorManagementClient(cloudResource.root.credentials, cloudResource.root.subscriptionId);
        const diagnosticSettings = await diagnosticMonitor.diagnosticSettingsOperations.list(cloudResource.id);

        return diagnosticSettings;
    } catch (e) {
        vscode.window.showErrorMessage(`Error fetching cluster diagnostic monitor: ${e}`);
        return undefined;
    }
}

export async function selectStorageAccountAndInstallAKSPeriscope<T>(
    diagnosticSettings: amon.MonitorManagementModels.DiagnosticSettingsResourceCollection | undefined,
): Promise<string | undefined> {
    /*
        Check the diagnostic setting is 1 or more than 1:
          1. For the scenario of 1 storage account in diagnostic settings - Pick the storageId resource and get SAS.
          2. For the scenario for more than 1 then show VsCode quickPick to select and get SAS of selected.
    */

    if (diagnosticSettings && diagnosticSettings?.value!.length > 1) {
        const storageAccountNameToStorageIdMap: Map<string, string> = new Map();

        diagnosticSettings.value?.forEach((item): any => {
            if (item.storageAccountId) {
                const { name } = parseResource(item.storageAccountId!);
                if (!name) {
                    vscode.window.showInformationMessage(`Storage Id is malformed: ${item.storageAccountId}`);
                    return undefined;
                }
                storageAccountNameToStorageIdMap.set(name!, item.storageAccountId!);
            }
        });

        // Create quick pick for more than 1 storage account scenario.
        const selectedStorageAccount = await vscode.window.showQuickPick(
            Array.from(storageAccountNameToStorageIdMap.keys()).map((label) => ({ label })),
            {
                placeHolder: "Select storage account for periscope deployment:",
                ignoreFocusOut: true,
                onDidSelectItem: (item) => { return item.toString(); }
            });

        if (selectedStorageAccount?.label) {
            return storageAccountNameToStorageIdMap.get(selectedStorageAccount!.label);
        } else {
            return undefined;
        }

    } else if (diagnosticSettings && diagnosticSettings.value!.length === 1) {
        // In case of only one storage account associated, use the one (1) as default storage account and no UI will be displayed.
        const selectedStorageAccount = diagnosticSettings.value![0].storageAccountId!;
        return selectedStorageAccount;
    }

    return undefined;
}

export async function getStorageInfo(
    target: k8s.CloudExplorerV1.CloudExplorerResourceNode,
    diagnosticStorageAccountId: string
): Promise<PeriscopeStorage | undefined> {
    try {
        const clusterStorageInfo = <PeriscopeStorage>{};
        const { resourceGroupName, name: accountName } = parseResource(diagnosticStorageAccountId!);

        if (!resourceGroupName || !accountName) {
            vscode.window.showErrorMessage(`Invalid storage id ${diagnosticStorageAccountId} associated with the cluster`);
            return;
        }

        // Get keys from storage client.
        const cloudResource = target.cloudResource;
        const storageClient = new ast.StorageManagementClient(cloudResource.root.credentials, cloudResource.root.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        clusterStorageInfo.storageName = accountName;
        clusterStorageInfo.storageKey = storageAccKeyList.keys?.find((it) => it.keyName === "key1")?.value!;

        // Generate 5 mins downlable shortlived sas along with 7 day shareable SAS.
        clusterStorageInfo.storageDeploymentSas = getSASKey(accountName, clusterStorageInfo.storageKey!, SASExpiryTime.FiveMinutes);
        clusterStorageInfo.sevenDaysSasyKey = getSASKey(accountName, clusterStorageInfo.storageKey!, SASExpiryTime.SevenDays);

        return clusterStorageInfo;
    } catch (e) {
        vscode.window.showErrorMessage(`Storage associated with cluster had following error: ${e}`);
        return undefined;
    }
}

export function writeTempAKSDeploymentFile(file: any) {
    const https = require("https");

    https.get('https://raw.githubusercontent.com/Azure/aks-periscope/master/deployment/aks-periscope.yaml', (res: any) => {
        res.pipe(file);
    }).on("error", (err: any) => {
        vscode.window.showWarningMessage(`Error encountered writing aks-deployment file: ${err.message}`);
    });
}

export function replaceDeploymentAccountNameAndSas(
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
        recursive: true,
        silent: true,
    });

    replace({
        regex: "# <saskey, base64 encoded>",
        replacement: `"${base64Sas}"`,
        paths: [aksPeriscopeFilePath],
        recursive: true,
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
        const sevenDaySas = periscopeStorage.sevenDaysSasyKey;

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
        const periscopeHtmlinterfaceList = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            // Get the latest uploaded folder, then Identify the Zip files in the latest uploaded logs within that folder
            // and extract *.zip files which are individual node logs.
            const periscopeHTMLInterface = <PeriscopeHTMLInterface>{};
            if (blob.name.indexOf(listCurrentUploadedFolders.sort().reverse()[0]) !== -1 && blob.name.indexOf('.zip') !== -1) {
                periscopeHTMLInterface.storageTimeStamp = path.parse(blob.name).dir.split('/')[0];
                periscopeHTMLInterface.nodeLogFileName = path.parse(blob.name).name;
                periscopeHTMLInterface.downloadableZipFilename = `${path.parse(blob.name).name}-downloadable`;
                periscopeHTMLInterface.downloadableZipUrl = `${containerClient.url}/${blob.name}${sas}`;
                periscopeHTMLInterface.downloadableZipShareFilename = `${path.parse(blob.name).name}-share`;
                periscopeHTMLInterface.downloadableZipShareUrl = `${containerClient.url}/${blob.name}${sevenDaySas}`;
                periscopeHtmlinterfaceList.push(periscopeHTMLInterface);
            }
        }
        return periscopeHtmlinterfaceList;
    } catch (e) {
        vscode.window.showErrorMessage(`Error generating downloadable link: ${e}`);
        return undefined;
    }
}

export function getWebviewContent(
    clustername: string,
    vscodeExtensionPath: string,
    output: any,
    periscopeStorageInfo: PeriscopeStorage | undefined,
    downloadAndShareNodeLogsList: PeriscopeHTMLInterface[] | undefined,
    hasDiagnosticSettings = true
): string {
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const commandOutput = output?.stderr + output?.stdout;

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
    htmlhandlers.registerHelper("equalsZero", equalsZeroHelper);
    htmlhandlers.registerHelper("anyNumberButZero", anyNumberButZeroHelper);
}

function equalsZeroHelper(value: number): boolean {
    if (value === 0) {
        return true;
    } else {
        return false;
    }
}

function anyNumberButZeroHelper(value: any): boolean {
    if (!isNaN(Number(value)) && value !== 0) {
        return true;
    } else {
        return false;
    }
}