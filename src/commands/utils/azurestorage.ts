import {
    AccountSASPermissions,
    AccountSASResourceTypes,
    AccountSASServices,
    SASProtocol,
    StorageSharedKeyCredential,
    generateAccountSASQueryParameters,
} from "@azure/storage-blob";

export enum LinkDuration {
    StartTime,
    DownloadNow,
    Shareable,
}

function sasDuration(duration: LinkDuration): number {
    switch (duration) {
        case LinkDuration.StartTime:
            return 2 * 60 * 1000;
        case LinkDuration.DownloadNow:
            return 15 * 60 * 1000; // 15 minutes to allow for Windows image pulls and log export
        case LinkDuration.Shareable:
            return 7 * 24 * 60 * 60 * 1000;
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
