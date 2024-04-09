import { Uri } from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { InitialState, NodeName, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/retinaCapture";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

export class RetinaCapturePanel extends BasePanel<"retinaCapture"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "retinaCapture", { 
            startCaptureResponse: "", 
            getAllNodesResponse: []
        });
    }


    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            retinaCaptureResult: (node: string) => this.startCaptureResponse(node, webview),
            getAllNodes: () => this.handleGetAllNodesResponse("", webview),
        };
    }

    private async startCaptureResponse(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        console.log(node);
        console.log(webview);
        return ;
    }

    private async handleGetAllNodesResponse(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        console.log(node);
        console.log(webview);
        return ;
    }
}


export class RetinaCaptureProvider implements PanelDataProvider<"retinaCapture"> {
    constructor(
        readonly clusterName: string,
        readonly retinaOutput: string,
    ) {}
    getTitle(): string {
        return `Retina Distributed Capture on ${this.clusterName}`;
    }
    getTelemetryDefinition(): TelemetryDefinition<"retinaCapture"> {
       return {
        retinaCaptureResult: (args: string) => args, // Add the missing 'clusterName' property with the correct type signature
        getAllNodes: false,
       }
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            retinaOutput: [this.retinaOutput],
            allNodes: []
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            retinaCaptureResult: (node: string) => this.startCaptureResponse(node, webview),
            getAllNodes: () => this.handleGetAllNodesResponse("", webview),
        };
    }

    handleGetAllNodesResponse(arg0: string, webview: MessageSink<ToWebViewMsgDef>): void {
        console.log(arg0);
        console.log(webview);
        throw new Error("Method not implemented. 1");
    }
    startCaptureResponse(node: string, webview: MessageSink<ToWebViewMsgDef>): void {
        console.log(node);
        console.log(webview);
        throw new Error("Method not implemented. 2");
    }
}