import {
    AccountSASPermissions,
    AccountSASResourceTypes,
    AccountSASServices,
    BlobServiceClient,
    SASProtocol,
    StorageSharedKeyCredential,
    generateAccountSASQueryParameters,
} from "@azure/storage-blob";
import { getStorageManagementClient } from "./arm";
import { Errorable, getErrorMessage } from "./errorable";
import { parseResource } from "../../azure-api-utils";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { AksClusterTreeNode } from "../../tree/aksClusterTreeItem";
import * as vscode from "vscode";
import { longRunning } from "./host";

export enum LinkDuration {
    StartTime,
    DownloadNow,
    Shareable,
    OneHour,
}

export interface StorageAcctInfo {
    storageName: string;
    storageKey: string;
    blobEndpoint: string;
}

function sasDuration(duration: LinkDuration): number {
    switch (duration) {
        case LinkDuration.StartTime:
            return 2 * 60 * 1000;
        case LinkDuration.DownloadNow:
            return 15 * 60 * 1000; // 15 minutes to allow for Windows image pulls and log export
        case LinkDuration.Shareable:
            return 7 * 24 * 60 * 60 * 1000;
        case LinkDuration.OneHour:
            return 60 * 60 * 1000;
    }
}

function sasPermission(duration: LinkDuration): string {
    // Restrict the permission as default permissioning model.
    const shareablePermissions = "rlp";
    switch (duration) {
        case LinkDuration.DownloadNow:
            return `${shareablePermissions}acwdu`;
        default:
            return shareablePermissions;
    }
}

export function getSASKey(storageAccount: string, storageKey: string, linkDuration: LinkDuration): string {
    const startDate = new Date();
    const expiryDate = new Date();

    startDate.setTime(startDate.getTime() - sasDuration(LinkDuration.StartTime));
    expiryDate.setTime(expiryDate.getTime() + sasDuration(linkDuration));

    const permissionsForSas = sasPermission(linkDuration);

    // The Azure storage client doesn't export constants.
    // The ones we declare here are copied from https://github.com/Azure/azure-storage-node/blob/c4226315f037f2791f7c938e900b3497c9c0a67a/lib/common/util/constants.js#L179
    const creds = new StorageSharedKeyCredential(storageAccount, storageKey);
    const accountSharedAccessSignature = generateAccountSASQueryParameters(
        {
            expiresOn: expiryDate,
            permissions: AccountSASPermissions.parse(permissionsForSas),
            protocol: SASProtocol.Https,
            resourceTypes: AccountSASResourceTypes.parse("sco").toString(),
            services: AccountSASServices.parse("b").toString(),
            startsOn: startDate,
        },
        creds,
    ).toString();

    // Generate SAS.
    const sas = `?${accountSharedAccessSignature}`;

    return sas;
}

export async function getStorageAcctInfo(
    sessionProvider: ReadyAzureSessionProvider,
    clusterNode: AksClusterTreeNode,
    diagnosticStorageAccountId: string,
): Promise<Errorable<StorageAcctInfo>> {
    try {
        const { resourceGroupName, name: accountName } = parseResource(diagnosticStorageAccountId);

        if (!resourceGroupName || !accountName) {
            return {
                succeeded: false,
                error: `Invalid storage id ${diagnosticStorageAccountId} associated with the cluster`,
            };
        }

        // Get keys from storage client.
        const storageClient = getStorageManagementClient(sessionProvider, clusterNode.subscriptionId);
        const storageAccKeyList = await storageClient.storageAccounts.listKeys(resourceGroupName, accountName);
        if (storageAccKeyList.keys === undefined) {
            return { succeeded: false, error: "No keys found for storage account." };
        }

        const storageKeyObject = storageAccKeyList.keys.find((it) => it.keyName === "key1");
        if (storageKeyObject === undefined) {
            return { succeeded: false, error: "No key with name 'key1' found for storage account." };
        }

        const storageKey = storageKeyObject.value;
        if (storageKey === undefined) {
            return { succeeded: false, error: "Storage key with name 'key1' has no value." };
        }

        const acctProperties = await storageClient.storageAccounts.getProperties(resourceGroupName, accountName);
        const blobEndpoint = acctProperties.primaryEndpoints?.blob;
        if (blobEndpoint === undefined) {
            return { succeeded: false, error: "Unable to retrieve blob endpoint from storage account." };
        }

        const clusterStorageInfo = {
            storageName: accountName,
            storageKey: storageKey,
            blobEndpoint,
        };

        return { succeeded: true, result: clusterStorageInfo };
    } catch (e) {
        return { succeeded: false, error: `Storage associated with cluster had following error: ${e}` };
    }
}

export async function chooseContainerInStorageAccount(
    sessionProvider: ReadyAzureSessionProvider,
    storageAccountId: string,
    blobEndpoint: string,
): Promise<string | undefined> {
    if (!storageAccountId) {
        return undefined;
    }

    const { subscriptionId, resourceGroupName, name: accountName } = parseResource(storageAccountId);
    if (!subscriptionId || !resourceGroupName || !accountName) {
        vscode.window.showErrorMessage(`Invalid storage account ID format: ${storageAccountId}`);
        return undefined;
    }

    try {
        // List containers in the selected storage account
        const containers = await longRunning(
            `Getting containers in ${accountName}...`,
            async () => await listStorageContainers(sessionProvider, blobEndpoint),
        );

        if (containers.length === 0) {
            vscode.window.showErrorMessage(`No containers found in storage account ${accountName}`);
            return undefined;
        }

        // If only one container, use it automatically
        if (containers.length === 1) {
            vscode.window.showInformationMessage(`Using the only available container: ${containers[0]}`);
            return containers[0];
        }

        // Otherwise let the user choose from multiple containers
        const selectedContainer = await vscode.window.showQuickPick(
            containers.map((container) => ({
                label: container,
            })),
            {
                placeHolder: "Select a container for storing data",
                ignoreFocusOut: true,
            },
        );

        return selectedContainer?.label;
    } catch (error) {
        vscode.window.showErrorMessage(`Error listing containers: ${getErrorMessage(error)}`);
        return undefined;
    }
}

async function listStorageContainers(
    sessionProvider: ReadyAzureSessionProvider,
    blobEndpoint: string,
): Promise<string[]> {
    // Get a credential with the proper Azure Storage scope
    const storageCredential = await getStorageCredential(sessionProvider);
    const blobServiceClient = new BlobServiceClient(blobEndpoint, storageCredential);

    // List all containers
    const containers: string[] = [];
    const containerIterator = blobServiceClient.listContainers();

    for await (const container of containerIterator) {
        containers.push(container.name);
    }

    return containers;
}

async function getStorageCredential(sessionProvider: ReadyAzureSessionProvider) {
    // Azure Storage requires the storage scope instead of the default ARM scope
    const storageScopes = ["https://storage.azure.com/.default"];

    return {
        getToken: async () => {
            const session = await sessionProvider.getAuthSession({ scopes: storageScopes });
            if (!session.succeeded) {
                throw new Error(`No Microsoft authentication session found: ${session.error}`);
            }

            // Use the actual expiration timestamp if available, otherwise fallback to 1 hour from now
            let expiresOnTimestamp: number;
            if (session.result.expiresOn) {
                // expiresOn may be a Date object or a string
                const expiresOnDate = typeof session.result.expiresOn === "string"
                    ? new Date(session.result.expiresOn)
                    : session.result.expiresOn;
                expiresOnTimestamp = expiresOnDate.getTime();
            } else if (session.result.expiresOnTimestamp) {
                expiresOnTimestamp = session.result.expiresOnTimestamp;
            } else {
                // Fallback: 1 hour from now
                expiresOnTimestamp = Date.now() + 60 * 60 * 1000;
            }
            return { token: session.result.accessToken, expiresOnTimestamp };
        },
    };
}
