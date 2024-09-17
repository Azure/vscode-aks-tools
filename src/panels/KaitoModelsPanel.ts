// src/panels/KaitoModelsPanel.ts

import { BasePanel, PanelDataProvider } from "./BasePanel";
import * as vscode from "vscode";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoModels";
import { InitialState } from "../webview-contract/webviewDefinitions/kaito";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

export class KaitoModelsPanel extends BasePanel<"kaitoModels"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaitoModels", {
            generateCRDResponse: null,
        });
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            generateCRDRequest: (params) => {
                this.handleGenerateCRDRequest(webview, params.model);
            },
        };
    }

    private async handleGenerateCRDRequest(webview: MessageSink<ToWebViewMsgDef>, model: string) {
        // Generate CRD logic here
        const crdText = `Generated CRD for model: ${model}`;
        vscode.window.showInformationMessage(crdText);

        webview.postGenerateCRDResponse({
            crdText: crdText,
        });
    }
}

export class KaitoModelsPanelDataProvider implements PanelDataProvider<"kaitoModels"> {
    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly armId: string,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
    }
    getTitle(): string {
        return `KAITO`;
    }
    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            subscriptionId: this.subscriptionId,
            resourceGroupName: this.resourceGroupName,
        };
    }
    getTelemetryDefinition(): TelemetryDefinition<"kaitoModels"> {
        return {
            generateCRDRequest: true,
        };
    }
    // getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
    //     return {
    //         generateCRDRequest: () => {
    //             this.handleGenerateCRDRequest(webview);
    //         },
    //     };
    // }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            generateCRDRequest: (params) => {
                this.handleGenerateCRDRequest(webview, params.model);
            },
        };
    }
    // private async handleGenerateCRDRequest(webview: MessageSink<ToWebViewMsgDef>) {
    //     // Generate CRD logic here
    //     const crdText = `Generated the CRD bro...`;
    //     vscode.window.showInformationMessage(crdText);

    //     webview.postGenerateCRDResponse({
    //         crdText: crdText,
    //     });
    // }
    private async handleGenerateCRDRequest(webview: MessageSink<ToWebViewMsgDef>, yaml: string) {
        // Generate CRD logic here

        const doc = await vscode.workspace.openTextDocument({
            content: yaml,
            language: "yaml",
        });

        vscode.window.showTextDocument(doc);
        void webview;

        // const crdText = `Generated CRD for model: ${model}`;
        // vscode.window.showInformationMessage(crdText);

        // webview.postGenerateCRDResponse({
        //     crdText: crdText,
        // });
    }
}
