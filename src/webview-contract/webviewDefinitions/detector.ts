import { WebviewDefinition } from "../webviewTypes";

export interface InitialState {
    name: string;
    description: string;
    clusterArmId: string;
    portalReferrerContext: string;
    detectors: SingleDetectorARMResponse[];
}

export interface ARMResponse<TDatasets> {
    id: string;
    name: string;
    type: string;
    location: string;
    properties: {
        dataset: TDatasets;
        metadata: {
            category: string;
            description: string;
            id: string;
            name: string;
            type: string;
        };
        status: {
            message: string | null;
            statusId: number;
        };
    };
}

interface Column {
    columnName: string;
    columnType: null;
    dataType: string;
}

export type RowValue = string | boolean | number;

interface Dataset<TRenderingProperties> {
    renderingProperties: TRenderingProperties;
    table: {
        columns: Column[];
        rows: RowValue[][];
        tableName: string;
    };
}

interface RenderingProperties {
    description: string | null;
    isVisible: boolean;
    title: string | null;
    type: number;
}

interface CategoryDetectorRenderingProperties extends RenderingProperties {
    additionalParams: string;
    detectorIds: string[];
    messageIfCritical: string | null;
    resourceUri: string;
}

export type CategoryDataset = Dataset<CategoryDetectorRenderingProperties>;

export type SingleDataset = Dataset<RenderingProperties>;

export type CategoryDetectorARMResponse = ARMResponse<(CategoryDataset | SingleDataset)[]>;

export type SingleDetectorARMResponse = ARMResponse<SingleDataset[]>;

export function isCategoryDataset(dataset: CategoryDataset | SingleDataset): dataset is CategoryDataset {
    return (dataset as CategoryDataset).renderingProperties.detectorIds !== undefined;
}

export type ToWebViewMsgDef = Record<string, never>;

export type ToVsCodeMsgDef = Record<string, never>;

export type DetectorDefinition = WebviewDefinition<InitialState, ToVsCodeMsgDef, ToWebViewMsgDef>;
