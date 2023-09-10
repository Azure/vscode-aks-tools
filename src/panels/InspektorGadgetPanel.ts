import * as vscode from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { failed, getErrorMessage } from '../commands/utils/errorable';
import { ClusterOperations } from '../commands/aksInspektorGadget/clusterOperations';
import { TraceWatcher } from '../commands/aksInspektorGadget/traceWatcher';
import { GadgetArguments, InitialState, ToVsCodeMsgDef, ToWebViewMsgDef, TraceOutputItem } from "../webview-contract/webviewDefinitions/inspektorGadget";

export class InspektorGadgetPanel extends BasePanel<"gadget"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "gadget");
    }
}

export class InspektorGadgetDataProvider implements PanelDataProvider<"gadget"> {
    constructor(
        readonly clusterOperations: ClusterOperations,
        readonly clusterName: string,
        readonly traceWatcher: TraceWatcher
    ) { }

    getTitle(): string {
        return `Inspektor Gadget on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {};
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getVersionRequest: _ => this._handleGetVersionRequest(webview),
            deployRequest: _ => this._handleDeployRequest(webview),
            undeployRequest: _ => this._handleUndeployRequest(webview),
            runStreamingTraceRequest: args => this._handleRunStreamingTraceRequest(args.traceId, args.arguments, webview),
            runBlockingTraceRequest: args => this._handleRunBlockingTraceRequest(args.traceId, args.arguments, webview),
            stopStreamingTraceRequest: _ => this._handleStopStreamingTraceRequest(),
            getNodesRequest: _ => this._handleGetNodesRequest(webview),
            getNamespacesRequest: _ => this._handleGetNamespacesRequest(webview),
            getPodsRequest: args => this._handleGetPodsRequest(args.namespace, webview),
            getContainersRequest: args => this._handleGetContainersRequest(args.namespace, args.podName, webview),
        };
    }

    private async _handleGetVersionRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.getGadgetVersion();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postMessage({ command: "updateVersion", parameters: version.result });
    }

    private async _handleDeployRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.deploy();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postMessage({ command: "updateVersion", parameters: version.result });
    }

    private async _handleUndeployRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.undeploy();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postMessage({ command: "updateVersion", parameters: version.result });
    }

    private async _handleRunStreamingTraceRequest(traceId: number, args: GadgetArguments, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const outputItemsHandler = (items: TraceOutputItem[]) => webview.postMessage({ command: "runTraceResponse", parameters: {traceId, items} });

        await this.traceWatcher.watch(args, outputItemsHandler, e => vscode.window.showErrorMessage(getErrorMessage(e)));
    }

    private async _handleRunBlockingTraceRequest(traceId: number, args: GadgetArguments, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const items = await this.clusterOperations.runTrace(args);
        if (failed(items)) {
            vscode.window.showErrorMessage(items.error);
            return;
        }

        webview.postMessage({ command: "runTraceResponse", parameters: {traceId, items: items.result} });
    }

    private async _handleStopStreamingTraceRequest(): Promise<void> {
        await this.traceWatcher.stopWatching();
    }

    private async _handleGetNodesRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const nodes = await this.clusterOperations.getNodes();
        if (failed(nodes)) {
            vscode.window.showErrorMessage(nodes.error);
            return;
        }

        webview.postMessage({ command: "getNodesResponse", parameters: {nodes: nodes.result} });
    }

    private async _handleGetNamespacesRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const namespaces = await this.clusterOperations.getNamespaces();
        if (failed(namespaces)) {
            vscode.window.showErrorMessage(namespaces.error);
            return;
        }

        webview.postMessage({ command: "getNamespacesResponse", parameters: {namespaces: namespaces.result} });
    }

    private async _handleGetPodsRequest(namespace: string, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const pods = await this.clusterOperations.getPods(namespace);
        if (failed(pods)) {
            vscode.window.showErrorMessage(pods.error);
            return;
        }

        webview.postMessage({ command: "getPodsResponse", parameters: {namespace, podNames: pods.result} });
    }

    private async _handleGetContainersRequest(namespace: string, podName: string, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const containers = await this.clusterOperations.getContainers(namespace, podName);
        if (failed(containers)) {
            vscode.window.showErrorMessage(containers.error);
            return;
        }

        webview.postMessage({ command: "getContainersResponse", parameters: {namespace, podName, containerNames: containers.result} });
    }
}
