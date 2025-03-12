import {
    AccountSASPermissions,
    AccountSASResourceTypes,
    AccountSASServices,
    SASProtocol,
    StorageSharedKeyCredential,
    generateAccountSASQueryParameters,
} from "@azure/storage-blob";
import { getStorageManagementClient } from "./arm";
import { Errorable } from "./errorable";
import { parseResource } from "../../azure-api-utils";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { AksClusterTreeNode } from "../../tree/aksClusterTreeItem";

export enum LinkDuration {
    StartTime,
    DownloadNow,
    Shareable,
    OneHour,
}

export interface BlobStorageInfo {
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

export async function getBlobStorageInfo(
    sessionProvider: ReadyAzureSessionProvider,
    clusterNode: AksClusterTreeNode,
    diagnosticStorageAccountId: string,
): Promise<Errorable<BlobStorageInfo>> {
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
