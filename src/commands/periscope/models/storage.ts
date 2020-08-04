export interface PeriscopeStorage {
    storageName: string;
    storageKey: string;
    storageDeploymentSas: string;
    sevenDaysSasyKey: string;
  }

  export interface PeriscopeHTMLInterface {
    storageTimeStamp: string;
    nodeLogFileName: string;
    downloadableZipFilename: string;
    downloadableZipUrl: string;
    downloadableZipShareFilename: string;
    downloadableZipShareUrl: string;
  }
