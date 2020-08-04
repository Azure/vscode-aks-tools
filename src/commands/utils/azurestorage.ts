const storage = require("azure-storage");

export enum SASExpiryTime {
    FiveMinutes = 5,
    SevenDays = 7
}

export function getSASKey(
    storageAccount: string,
    storageKey: string,
    sasExpirationTime: SASExpiryTime
): string {

    const startDate = new Date();
    const expiryDate = new Date();
    const fiveMinutesInMilliseconds = 5 * 60 * 1000;
    const weekInMilliseconds = 7 * 24 * 60 * 60 * 1000;

    startDate.setTime(startDate.getTime() - fiveMinutesInMilliseconds);

    let expirationTime = expiryDate.getTime();
    const AccountSasConstants = storage.Constants.AccountSasConstants;

    // Restrict the permission as default permissioning model.
    let permissionsForSas = AccountSasConstants.Permissions.READ + AccountSasConstants.Permissions.LIST + AccountSasConstants.Permissions.PROCESS;

    if (sasExpirationTime === SASExpiryTime.FiveMinutes) {
        // Default downloadable sas link creation expiry is 5 minutes.
        expirationTime = expirationTime + fiveMinutesInMilliseconds;
        permissionsForSas = permissionsForSas +
            AccountSasConstants.Permissions.ADD +
            AccountSasConstants.Permissions.CREATE +
            AccountSasConstants.Permissions.WRITE +
            AccountSasConstants.Permissions.DELETE +
            AccountSasConstants.Permissions.UPDATE ;

    } else if (sasExpirationTime === SASExpiryTime.SevenDays) {
        expirationTime = expirationTime + weekInMilliseconds;
    }

    expiryDate.setTime(expirationTime);

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