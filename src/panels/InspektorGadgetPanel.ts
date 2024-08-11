import * as vscode from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { ClusterOperations } from "../commands/aksInspektorGadget/clusterOperations";
import { TraceWatcher } from "../commands/aksInspektorGadget/traceWatcher";
import {
    GadgetArguments,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
    TraceOutputItem,
} from "../webview-contract/webviewDefinitions/inspektorGadget";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

export class InspektorGadgetPanel extends BasePanel<"gadget"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "gadget", {
            getContainersResponse: null,
            getNamespacesResponse: null,
            getNodesResponse: null,
            getPodsResponse: null,
            runTraceResponse: null,
            updateVersion: null,
        });
    }
}

export class InspektorGadgetDataProvider implements PanelDataProvider<"gadget"> {
    constructor(
        readonly clusterOperations: ClusterOperations,
        readonly clusterName: string,
        readonly traceWatcher: TraceWatcher,
    ) {}

    getTitle(): string {
        return `Inspektor Gadget on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"gadget"> {
        return {
            getVersionRequest: false,
            deployRequest: true,
            undeployRequest: true,
            runStreamingTraceRequest: (args) =>
                `streamTrace_${args.arguments.gadgetCategory}_${args.arguments.gadgetResource}`,
            runBlockingTraceRequest: (args) =>
                `runTrace_${args.arguments.gadgetCategory}_${args.arguments.gadgetResource}`,
            stopStreamingTraceRequest: true,
            getNodesRequest: false,
            getNamespacesRequest: false,
            getPodsRequest: false,
            getContainersRequest: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getVersionRequest: () => this.handleGetVersionRequest(webview),
            deployRequest: () => this.handleDeployRequest(webview),
            undeployRequest: () => this.handleUndeployRequest(webview),
            runStreamingTraceRequest: (args) =>
                this.handleRunStreamingTraceRequest(args.traceId, args.arguments, webview),
            runBlockingTraceRequest: (args) =>
                this.handleRunBlockingTraceRequest(args.traceId, args.arguments, webview),
            stopStreamingTraceRequest: () => this.handleStopStreamingTraceRequest(),
            getNodesRequest: () => this.handleGetNodesRequest(webview),
            getNamespacesRequest: () => this.handleGetNamespacesRequest(webview),
            getPodsRequest: (args) => this.handleGetPodsRequest(args.namespace, webview),
            getContainersRequest: (args) => this.handleGetContainersRequest(args.namespace, args.podName, webview),
        };
    }

    private async handleGetVersionRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.getGadgetVersion();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postUpdateVersion(version.result);
    }

    private async handleDeployRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.deploy();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postUpdateVersion(version.result);
    }

    private async handleUndeployRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const version = await this.clusterOperations.undeploy();
        if (failed(version)) {
            vscode.window.showErrorMessage(version.error);
            return;
        }

        webview.postUpdateVersion(version.result);
    }

    private async handleRunStreamingTraceRequest(
        traceId: number,
        args: GadgetArguments,
        webview: MessageSink<ToWebViewMsgDef>,
    ): Promise<void> {
        const outputItemsHandler = (items: TraceOutputItem[]) => webview.postRunTraceResponse({ traceId, items });

        await this.traceWatcher.watch(args, outputItemsHandler, (e) =>
            vscode.window.showErrorMessage(getErrorMessage(e)),
        );
    }

    private async handleRunBlockingTraceRequest(
        traceId: number,
        args: GadgetArguments,
        webview: MessageSink<ToWebViewMsgDef>,
    ): Promise<void> {
        const items = await this.clusterOperations.runTrace(args);
        if (failed(items)) {
            vscode.window.showErrorMessage(items.error);
            return;
        }

        webview.postRunTraceResponse({ traceId, items: items.result });
    }

    private async handleStopStreamingTraceRequest(): Promise<void> {
        await this.traceWatcher.stopWatching();
    }

    private async handleGetNodesRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const nodes = await this.clusterOperations.getNodes();
        if (failed(nodes)) {
            vscode.window.showErrorMessage(nodes.error);
            return;
        }

        webview.postGetNodesResponse({ nodes: nodes.result });
    }

    private async handleGetNamespacesRequest(webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const namespaces = await this.clusterOperations.getNamespaces();
        if (failed(namespaces)) {
            vscode.window.showErrorMessage(namespaces.error);
            return;
        }

        webview.postGetNamespacesResponse({ namespaces: namespaces.result });
    }

    private async handleGetPodsRequest(namespace: string, webview: MessageSink<ToWebViewMsgDef>): Promise<void> {
        const pods = await this.clusterOperations.getPods(namespace);
        if (failed(pods)) {
            vscode.window.showErrorMessage(pods.error);
            return;
        }

        webview.postGetPodsResponse({ namespace, podNames: pods.result });
    }

    private async handleGetContainersRequest(
        namespace: string,
        podName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ): Promise<void> {
        const containers = await this.clusterOperations.getContainers(namespace, podName);
        if (failed(containers)) {
            vscode.window.showErrorMessage(containers.error);
            return;
        }

        webview.postGetContainersResponse({ namespace, podName, containerNames: containers.result });
    }
}
