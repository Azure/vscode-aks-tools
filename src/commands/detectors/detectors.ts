import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { IActionContext } from "@microsoft/vscode-azext-utils";
import { getAksClusterTreeItem } from "../utils/clusters";
import { getExtension, longRunning } from "../utils/host";
import { getDetectorInfo, getDetectorListData } from "../utils/detectors";
import { Errorable, failed } from "../utils/errorable";
import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { DetectorDataProvider, DetectorPanel } from "../../panels/DetectorPanel";

export function aksBestPracticesDiagnostics(_context: IActionContext, target: unknown): Promise<void> {
    return runDetector(target, "aks-category-risk-assessment");
}

export function aksCategoryConnectivity(_context: IActionContext, target: unknown): Promise<void> {
    return runDetector(target, "aks-category-connectivity");
}

export function aksCRUDDiagnostics(_context: IActionContext, target: unknown): Promise<void> {
    return runDetector(target, "aks-category-crud");
}

export function aksIdentitySecurityDiagnostics(_context: IActionContext, target: unknown): Promise<void> {
    return runDetector(target, "aks-category-identity-security");
}

export function aksKnownIssuesAvailabilityPerformanceDiagnostics(
    _context: IActionContext,
    target: unknown,
): Promise<void> {
    return runDetector(target, "aks-category-availability-perf");
}

export function aksNodeHealth(_context: IActionContext, target: unknown): Promise<void> {
    return runDetector(target, "aks-category-node-health");
}

async function runDetector(commandTarget: unknown, categoryDetectorName: string) {
    const cloudExplorer = await k8s.extension.cloudExplorer.v1;

    const cluster = getAksClusterTreeItem(commandTarget, cloudExplorer);
    if (failed(cluster)) {
        vscode.window.showErrorMessage(cluster.error);
        return;
    }

    const extension = getExtension();
    if (failed(extension)) {
        vscode.window.showErrorMessage(extension.error);
        return;
    }

    const clustername = cluster.result.name;
    const dataProvider = await longRunning(`Loading ${clustername} diagnostics.`, () =>
        getDataProvider(cluster.result, categoryDetectorName),
    );

    if (failed(dataProvider)) {
        vscode.window.showErrorMessage(dataProvider.error);
        return;
    }

    const panel = new DetectorPanel(extension.result.extensionUri);
    panel.show(dataProvider.result);
}

async function getDataProvider(
    cloudTarget: AksClusterTreeItem,
    categoryDetectorName: string,
): Promise<Errorable<DetectorDataProvider>> {
    const detectorInfo = await getDetectorInfo(cloudTarget, categoryDetectorName);
    if (failed(detectorInfo)) {
        return detectorInfo;
    }

    const detectors = await getDetectorListData(cloudTarget, detectorInfo.result);
    if (failed(detectors)) {
        return detectors;
    }

    const dataProvider = new DetectorDataProvider(
        cloudTarget.subscription.environment,
        cloudTarget.name,
        detectorInfo.result,
        detectors.result,
    );
    return { succeeded: true, result: dataProvider };
}
