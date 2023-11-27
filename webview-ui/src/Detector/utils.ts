import { SingleDataset, SingleDetectorARMResponse } from "../../../src/webview-contract/webviewDefinitions/detector";

const insightDatasetType = 7;

enum InsightColumnName {
    Status = "Status",
    Message = "Message",
    DataName = "Data.Name",
    DataValue = "Data.Value",
}

const insightColumnIndexMap = new Map(Object.values(InsightColumnName).map((name, index) => [name, index]));

export enum Status {
    Success = 0,
    Warning,
    Error,
}

export function getOverallStatus(response: SingleDetectorARMResponse): Status {
    const statuses = response.properties.dataset
        .filter((d) => d.renderingProperties.type === insightDatasetType)
        .map(getStatusForInsightDataset)
        .filter(isInsightResult)
        .map((r) => r.status);

    return Math.max(...statuses);
}

export interface InsightResult {
    status: Status;
    message: string;
}

export interface ErrorInfo {
    error: string;
    data: unknown;
}

export function isInsightResult(result: InsightResult | ErrorInfo): result is InsightResult {
    return (result as InsightResult).status !== undefined;
}

export function getStatusForInsightDataset(dataset: SingleDataset): InsightResult | ErrorInfo {
    // One insight has a single overall `Status` and `Message`, even if it contains several rows.
    if (dataset.table.rows.length === 0) {
        return {
            error: "Expected at least 1 row",
            data: dataset.table,
        };
    }

    // Check we have the columns we're expecting.
    if (dataset.table.columns.length < 4) {
        return {
            error: "Expected at least 4 columns",
            data: dataset.table,
        };
    }

    Object.values(InsightColumnName).forEach((colName, index) => {
        const actualColName = dataset.table.columns[index].columnName;
        if (actualColName !== colName) {
            return {
                message: `Expected column ${index} to have name ${colName}, but found ${actualColName}`,
                data: dataset.table.columns,
            };
        }
    });

    const statusColumnIndex = insightColumnIndexMap.get(InsightColumnName.Status)!;
    const messageColumnIndex = insightColumnIndexMap.get(InsightColumnName.Message)!;
    const statusValue = dataset.table.rows[0][statusColumnIndex];
    const message = dataset.table.rows[0][messageColumnIndex] as string;
    const status =
        statusValue === "Success" ? Status.Success : statusValue === "Warning" ? Status.Warning : Status.Error;

    return { status, message };
}
