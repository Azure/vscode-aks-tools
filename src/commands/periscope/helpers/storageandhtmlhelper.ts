import * as vscode from 'vscode';
import { getSASKey } from '../../utils/host';
import { parseResource } from '../../../azure-api-utils';
import * as ast from 'azure-arm-storage';
import { PeriscopeStorage } from '../models/storage';
import * as amon from 'azure-arm-monitor';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as fs from 'fs';

const {
    BlobServiceClient,
    StorageSharedKeyCredential
} = require("@azure/storage-blob");

export async function getClusterDiagnosticSettings(target: any) {
    try {
        // Get daignostic setting via diagnostic monitor
        const diagnosticMonitor = new amon.MonitorManagementClient(target.root.credentials, target.root.subscriptionId);
        const diagnosticSettings = await diagnosticMonitor.diagnosticSettingsOperations.list(target.id);

        return diagnosticSettings;
    } catch (e) {
        vscode.window.showErrorMessage(`Can't: ${e}`);
        return undefined;
    }
}

export async function getStorageInfo(
    target: any,
    diagnosticStorageAccountId: string
): Promise<PeriscopeStorage | undefined> {
    try {
        const { resourceGroupName, name: accountName } = parseResource(diagnosticStorageAccountId!);

        if (!resourceGroupName || !accountName) {
            vscode.window.showErrorMessage(`Invalid storage id ${diagnosticStorageAccountId} associated with the cluster`);
            return;
        }

        // Get keys from storage client.
        const storageClient = new ast.StorageManagementClient(target.root.credentials, target.root.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        const accountKey = storageAccKeyList?.keys!.find((it) => it.keyName === "key1")?.value;

        // Generate SAS.
        const sas = getSASKey(accountName, accountKey!);

        return <PeriscopeStorage>{ storageName: accountName, storageKey: accountKey, storageDeploymentSas: sas };
    } catch (e) {
        vscode.window.showErrorMessage(`Storage associated with cluster had following error: ${e}`);
        return undefined;
    }
}

export async function generateDownloadableLinks(
    periscopeStorage: PeriscopeStorage,
    output: string,
    generateSevenDaySas = false) {

    // Generate SAS.
    const storageAccount = periscopeStorage.storageName;
    const storageKey = periscopeStorage.storageKey;

    const sas = getSASKey(storageAccount, storageKey, generateSevenDaySas);

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

    const containerClient = blobServiceClient.getContainerClient(containerName);

    // List all current blob.
    const listCurrentUploadedFolders = [];
    for await (const item of containerClient.listBlobsByHierarchy("/")) {
        if (item.kind === "prefix") {
            console.log(`\tBlobPrefix: ${item.name}`);
            listCurrentUploadedFolders.push(item.name);
        }
    }

    // Sort and get the latest uploaded folder under the container used by periscope.
    const downloadableNodeLogsList = [];
    for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.name.indexOf(listCurrentUploadedFolders.sort().reverse()[0]) !== -1 && blob.name.indexOf('.zip') !== -1) {
            downloadableNodeLogsList.push(`${containerClient.url}/${blob.name}${sas}`);
            console.log(`Blob: ${blob.name}  + ${downloadableNodeLogsList}`);
        }
    }

    return downloadableNodeLogsList;
}

export async function getStorageAccountKeyUI(): Promise<string | undefined> {
    return await vscode.window.showInputBox({ placeHolder: 'Enter storage account key:', ignoreFocusOut: true }).then(
        (value) => {
            if (value) {
                return value;
            } else {
                return undefined;
            }
        });
}

export function replaceDeploymentAccountNameAndSas(
    periscopeStorageInfo: PeriscopeStorage,
    aksPeriscopeFilePath: string | Buffer) {

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

export function getWebviewContent(
    clustername: string,
    vscodeExtensionPath: string,
    output: any,
    periscopeStorageInfo: PeriscopeStorage,
    downloadableNodeLogsList: string[],
    sevenDaysDownloadableLinks: string[]
): string {
    const stylePathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.css'));
    const htmlPathOnDisk = vscode.Uri.file(path.join(vscodeExtensionPath, 'resources', 'webviews', 'periscope', 'periscope.html'));
    const styleUri = stylePathOnDisk.with({ scheme: 'vscode-resource' });
    const pathUri = htmlPathOnDisk.with({ scheme: 'vscode-resource' });

    const htmldata = fs.readFileSync(pathUri.fsPath, 'utf8').toString();
    const commandOutput = output.stderr + output.stdout;

    const template = htmlhandlers.compile(htmldata);
    const data = {
        cssuri: styleUri,
        storageAccName: periscopeStorageInfo.storageName,
        name: clustername,
        output: commandOutput,
        outputCode: output.code,
        downloadableLinks: downloadableNodeLogsList,
        sevenDaysDownloadableLinks: sevenDaysDownloadableLinks,
    };
    const webviewcontent = template(data);

    return webviewcontent;
}
