export interface PeriscopeStorage {
    containerName: string;
    storageName: string;
    storageKey: string;
    storageDeploymentSas: string;
    sevenDaysSasKey: string;
}

export interface PeriscopeHTMLInterface {
    storageTimeStamp: string;
    nodeLogFileName: string;
    downloadableZipFilename: string;
    downloadableZipUrl: string;
    downloadableZipShareFilename: string;
    downloadableZipShareUrl: string;
}
