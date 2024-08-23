import * as vscode from "vscode";
import { ReadyAzureSessionProvider } from "../auth/types";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaito";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";

export class KaitoPanel extends BasePanel<"kaito"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaito", {
            kaitoInstallProgressUpdate: null,
            getLLMModelsResponse: null,
            getWorkspaceResponse: null,
        });
    }
}

export class KaitoPanelDataProvider implements PanelDataProvider<"kaito"> {
    // private readonly resourceManagementClient: ResourceManagementClient;
    // private readonly containerServiceClient: ContainerServiceClient;

    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        // this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        // this.containerServiceClient = getAksClient(sessionProvider, this.subscriptionId);
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
    getTelemetryDefinition(): TelemetryDefinition<"kaito"> {
        return {
            installKaitoRequest: true,
            getLLMModelsRequest: true,
            generateWorkspaceRequest: true,
            deployWorkspace: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            installKaitoRequest: () => {
                this.handleKaitoInstallation(webview);
            },
            getLLMModelsRequest: () => {
                this.handleLLMModelsRequest(webview);
            },
            generateWorkspaceRequest: () => {
                // workspace: Workspace
                this.handleGenerateWorkspaceRequest(webview);
            },
            deployWorkspace: () => {
                this.handleDeployWorkspaceRequest(webview);
            },
        };
    }
    private async handleDeployWorkspaceRequest(webview: MessageSink<ToWebViewMsgDef>) {
        // deploy workspace CRD
        webview.postGetWorkspaceResponse({
            workspace: {
                workspace: "workspace CRD yaml",
            },
        });
    }

    private async handleGenerateWorkspaceRequest(webview: MessageSink<ToWebViewMsgDef>) {
        // after generate workspace CRD, deploy it.
        webview.postGetWorkspaceResponse({
            workspace: {
                workspace: "workspace CRD yaml",
            },
        });
    }
    private async handleLLMModelsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        // get supported llm models from static config
        webview.postGetLLMModelsResponse({
            models: [
                {
                    family: "family",
                    modelName: "modelName",
                    minimumGpu: 1,
                    kaitoVersion: "v1.0",
                    modelSource: "modelSource",
                },
            ],
        });
    }
    private async handleKaitoInstallation(webview: MessageSink<ToWebViewMsgDef>) {
        // install kaito
        webview.postKaitoInstallProgressUpdate({
            operationDescription: "Installing Kaito",
            event: 1,
            errorMessage: null,
            models: [],
        });

        // simulate kaito installation and success
        setTimeout(() => {
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Kaito installed",
                event: 4,
                errorMessage: null,
                models: [
                    {
                        family: "family",
                        modelName: "modelName",
                        minimumGpu: 1,
                        kaitoVersion: "v1.0",
                        modelSource: "modelSource",
                    },
                ],
            });
        }, 5000);
    }
}
