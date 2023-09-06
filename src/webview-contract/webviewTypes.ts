export module TestStyleViewerTypes {
    export const contentId = "style";

    export interface InitialState {
        isVSCode: boolean
    }

    export interface CssRule {
        selector: string,
        text: string
    }

    export type ToVsCodeMsgDef = {
        reportCssVars: {
            cssVars: string[]
        },
        reportCssRules: {
            rules: CssRule[]
        }
    };

    export type ToWebViewMsgDef = {};
}

export module PeriscopeTypes {
    export const contentId = "periscope";

    export interface NodeUploadStatus {
        nodeName: string
        isUploaded: boolean
    }

    export interface PodLogs {
        podName: string
        logs: string
    }

    export type DeploymentState = "error" | "noDiagnosticsConfigured" | "success";

    export interface KustomizeConfig {
        repoOrg: string
        containerRegistry: string
        imageVersion: string
        releaseTag: string
    }

    export interface InitialState {
        clusterName: string
        runId: string
        state: DeploymentState
        message: string
        nodes: string[]
        kustomizeConfig: KustomizeConfig | null
        blobContainerUrl: string
        shareableSas: string
    }

    export type ToVsCodeMsgDef = {
        uploadStatusRequest: void,
        nodeLogsRequest: {
            nodeName: string
        }
    };

    export type ToWebViewMsgDef = {
        uploadStatusResponse: {
            uploadStatuses: NodeUploadStatus[]
        },
        nodeLogsResponse: {
            nodeName: string,
            logs: PodLogs[]
        }
    };
}

export module DetectorTypes {
    export const contentId = "detector";

    export interface InitialState {
        name: string
        description: string
        clusterArmId: string
        portalReferrerContext: string
        detectors: SingleDetectorARMResponse[]
    }

    export interface ARMResponse<TDatasets> {
        id: string
        name: string
        type: string
        location: string
        properties: {
            dataset: TDatasets
            metadata: {
                category: string
                description: string
                id: string
                name: string
                type: string
            }
            status: {
                message: string | null
                statusId: number
            }
        }
    }

    export interface Column {
        columnName: string
        columnType: null
        dataType: string
    }

    export interface Dataset<TRenderingProperties> {
        renderingProperties: TRenderingProperties
        table: {
            columns: Column[]
            rows: any[][]
            tableName: string
        }
    }

    export interface RenderingProperties {
        description: string | null
        isVisible: boolean
        title: string | null
        type: number
    }

    export interface CategoryDetectorRenderingProperties extends RenderingProperties {
        additionalParams: string
        detectorIds: string[]
        messageIfCritical: string | null
        resourceUri: string
    }

    export type CategoryDataset = Dataset<CategoryDetectorRenderingProperties>;

    export type SingleDataset = Dataset<RenderingProperties>;

    export type CategoryDetectorARMResponse = ARMResponse<(CategoryDataset | SingleDataset)[]>;

    export type SingleDetectorARMResponse = ARMResponse<SingleDataset[]>

    export function isCategoryDataset(dataset: CategoryDataset | SingleDataset): dataset is CategoryDataset {
        return (dataset as CategoryDataset).renderingProperties.detectorIds !== undefined;
    }

    export type ToVsCodeMsgDef = {};
    export type ToWebViewMsgDef = {};
}