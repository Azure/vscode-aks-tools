import storage = require("@azure/storage-blob");

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

function sasPermission(duration: LinkDuration): any {
    // Restrict the permission as default permissioning model.
    let permissionsForSas = "rlp";

    switch (duration) {
        case LinkDuration.DownloadNow:
            permissionsForSas = permissionsForSas + "acwdu";
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

    const permissionsForSas = sasPermission(linkDuration);

    // Please refer to the new implementation of azure-storage api here: https://github.com/Azure/azure-storage-node 
    // Constans used to be available externallbut not in new packages they dont.
    // https://github.com/Azure/azure-storage-node/blob/master/lib/common/util/constants.js#L179
    const cerds = new storage.StorageSharedKeyCredential(storageAccount, storageKey);
    const accountSharedAccessSignature = storage.generateAccountSASQueryParameters({
        expiresOn : expiryDate,
        permissions: storage.AccountSASPermissions.parse(permissionsForSas),
        protocol: storage.SASProtocol.Https,
        resourceTypes: storage.AccountSASResourceTypes.parse("sco").toString(),
        services: storage.AccountSASServices.parse("b").toString(),
        startsOn: startDate
    }, cerds).toString();

    // Generate SAS.
    const sas = "?" + accountSharedAccessSignature;

    return sas;
}
