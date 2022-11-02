export interface PeriscopeStorage {
    containerName: string;
    storageName: string;
    storageKey: string;
    blobEndpoint: string;
    storageDeploymentSas: string;
    sevenDaysSasKey: string;
}

export interface UploadStatus {
    nodeName: string;
    isUploaded: boolean;
}

export interface PodLogs {
    podName: string;
    logs: string;
}