import { Uri, window } from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { checkUploadStatus, getNodeLogs } from "../commands/periscope/helpers/periscopehelper";
import { KustomizeConfig } from "../commands/periscope/models/config";
import { PeriscopeStorage } from "../commands/periscope/models/storage";
import { failed } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { PeriscopeTypes } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { URL } from "url";

export class PeriscopePanel extends BasePanel<PeriscopeTypes.InitialState, PeriscopeTypes.ToWebViewMsgDef, PeriscopeTypes.ToVsCodeMsgDef> {
    constructor(extensionUri: Uri) {
        super(extensionUri, PeriscopeTypes.contentId);
    }
}

export interface DeploymentParameters {
    kubectl: k8s.APIAvailable<k8s.KubectlV1>
    kustomizeConfig: KustomizeConfig
    storage: PeriscopeStorage
    clusterKubeConfig: string
    periscopeNamespace: string
}

export class PeriscopeDataProvider implements PanelDataProvider<PeriscopeTypes.InitialState, PeriscopeTypes.ToWebViewMsgDef, PeriscopeTypes.ToVsCodeMsgDef> {
    private constructor(
        readonly clusterName: string,
        readonly deploymentState: PeriscopeTypes.DeploymentState,
        readonly runId: string,
        readonly nodes: string[],
        readonly message: string,
        readonly deploymentParameters: DeploymentParameters | null
    ) { }

    static createForNoDiagnostics(clusterName: string) {
        return new PeriscopeDataProvider(clusterName, "noDiagnosticsConfigured", "", [], "", null);
    }

    static createForDeploymentError(clusterName: string, runId: string, errorMessage: string, deploymentParameters: DeploymentParameters) {
        return new PeriscopeDataProvider(clusterName, "error", runId, [], errorMessage, deploymentParameters);
    }

    static createForDeploymentSuccess(clusterName: string, runId: string, nodes: string[], deploymentParameters: DeploymentParameters) {
        return new PeriscopeDataProvider(clusterName, "success", runId, nodes, "", deploymentParameters);
    }

    getTitle(): string {
        return `AKS Periscope ${this.clusterName}`;
    }

    getInitialState(): PeriscopeTypes.InitialState {
        const storage = this.deploymentParameters?.storage;
        const containerUrl = storage ? new URL(storage.containerName, storage.blobEndpoint).href : "";
        const shareableSas = storage ? storage.sevenDaysSasKey : "";
        return {
            clusterName: this.clusterName,
            runId: this.runId,
            state: this.deploymentState,
            message: this.message,
            nodes: this.nodes,
            kustomizeConfig: this.deploymentParameters?.kustomizeConfig || null,
            blobContainerUrl: containerUrl,
            shareableSas: shareableSas
        };
    }

    getMessageHandler(webview: MessageSink<PeriscopeTypes.ToWebViewMsgDef>): MessageHandler<PeriscopeTypes.ToVsCodeMsgDef> {
        return {
            nodeLogsRequest: args => this._handleNodeLogsRequest(args.nodeName, webview),
            uploadStatusRequest: () => this._handleUploadStatusRequest(webview)
        };
    }

    private async _handleUploadStatusRequest(webview: MessageSink<PeriscopeTypes.ToWebViewMsgDef>) {
        if (!this.deploymentParameters) {
            throw new Error('Node upload statuses cannot be checked when deployment parameters are not configured');
        }

        const uploadStatuses = await checkUploadStatus(this.deploymentParameters.storage, this.runId, this.nodes);
        webview.postMessage({ command: 'uploadStatusResponse', parameters: {uploadStatuses} });
    }

    private async _handleNodeLogsRequest(nodeName: string, webview: MessageSink<PeriscopeTypes.ToWebViewMsgDef>): Promise<void> {
        const deploymentParameters = this.deploymentParameters;
        if (!deploymentParameters) {
            throw new Error('Node logs cannot be retrieved when deployment parameters are not configured');
        }

        const logs = await longRunning(`Getting logs for node ${nodeName}.`, () => {
            return getNodeLogs(deploymentParameters.kubectl, deploymentParameters.clusterKubeConfig, deploymentParameters.periscopeNamespace, nodeName);
        });

        if (failed(logs)) {
            window.showErrorMessage(logs.error);
            return;
        }

        webview.postMessage({ command: 'nodeLogsResponse', parameters: {nodeName, logs: logs.result} });
    }
}
