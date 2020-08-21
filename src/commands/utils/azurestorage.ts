const storage = require("azure-storage");

export enum LinkDuration {
    StartTime,
    DownloadNow,
    Shareable,
}

function sasDuration(duration: LinkDuration): number {
    switch (duration) {
        case LinkDuration.StartTime: return 2 * 60 * 1000;
        case LinkDuration.DownloadNow: return 5 * 60 * 1000;
        case LinkDuration.Shareable: return 7 * 24 * 60 * 60 * 1000;
    }
}

function sasPermission(duration: LinkDuration, permission: any): any {
    // Restrict the permission as default permissioning model.
    let permissionsForSas = permission.READ + permission.LIST + permission.PROCESS;

    switch (duration) {
        case LinkDuration.DownloadNow:
            permissionsForSas = permissionsForSas + permission.ADD + permission.CREATE +
                permission.WRITE + permission.DELETE + permission.UPDATE;
            return permissionsForSas;
        case LinkDuration.Shareable:
            return permissionsForSas;
    }
}

export function getSASKey(
    storageAccount: string,
    storageKey: string,
    linkDuration: LinkDuration
): string {

    const startDate = new Date();
    const expiryDate = new Date();

    startDate.setTime(startDate.getTime() - sasDuration(LinkDuration.StartTime));
    expiryDate.setTime(expiryDate.getTime() + sasDuration(linkDuration));

    const AccountSasConstants = storage.Constants.AccountSasConstants;
    const permissionsForSas = sasPermission(linkDuration, AccountSasConstants.Permissions);

    const sharedAccessPolicy = {
        AccessPolicy: {
            Services: AccountSasConstants.Services.BLOB,
            ResourceTypes: AccountSasConstants.Resources.SERVICE +
                AccountSasConstants.Resources.CONTAINER +
                AccountSasConstants.Resources.OBJECT,
            Permissions: permissionsForSas,
            Start: startDate,
            Expiry: expiryDate
        }
    };

    // Generate SAS.
    const sas = "?" + storage.generateAccountSharedAccessSignature(storageAccount, storageKey, sharedAccessPolicy);

    return sas;
}
