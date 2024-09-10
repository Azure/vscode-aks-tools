import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import * as vscode from "vscode";
import kaitoSupporterModel from "../../resources/kaitollmconfig/kaitollmconfig.json";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksClient, getFeatureClient, getResourceManagementClient } from "../commands/utils/arm";
import { getErrorMessage } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    ModelDetails,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kaito";
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
    private readonly featureClient: FeatureClient;
    private readonly resourceManagementClient: ResourceManagementClient;
    private readonly containerServiceClient: ContainerServiceClient;

    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly armId: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly filterKaitoPodNames: string[],
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.featureClient = getFeatureClient(sessionProvider, this.subscriptionId);
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.containerServiceClient = getAksClient(sessionProvider, this.subscriptionId);
        this.filterKaitoPodNames = filterKaitoPodNames;
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
        // Check if Kaito pods already exist
        if (this.filterKaitoPodNames.length > 0) {
            vscode.window.showInformationMessage(
                `Kaito pods already exist in the cluster ${this.clusterName}. Skipping installation.`,
            );
            return;
        }
        // Register feature
        const subscriptionFeatureRegistrationType = {
            properties: {},
        };
        const options = {
            subscriptionFeatureRegistrationType,
        };

        const featureRegistrationPoller = await longRunning(`Registering the AIToolchainOperator.`, () => {
            return this.featureClient.subscriptionFeatureRegistrations.createOrUpdate(
                "Microsoft.ContainerService",
                "AIToolchainOperatorPreview",
                options,
            );
        });

        if (featureRegistrationPoller.properties?.state !== "Registered") {
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing Kaito",
                event: 3,
                errorMessage: "Failed to register feature",
                models: [],
            });
            return;
        }

        // Get current json
        const currentJson = await longRunning(`Get current cluster information.`, () => {
            return this.resourceManagementClient.resources.getById(this.armId, "2023-08-01");
        });

        console.log(currentJson);
        // Install kaito enablement
        const managedClusterSpec: ManagedCluster = {
            location: currentJson.location!,
            aiToolchainOperatorProfile: { enabled: true },
            oidcIssuerProfile: { enabled: true },
        };

        try {
            const poller = await longRunning(`Enabling the kaito for this cluster.`, () => {
                return this.containerServiceClient.managedClusters.beginCreateOrUpdate(
                    this.resourceGroupName,
                    this.clusterName,
                    managedClusterSpec,
                );
            });
            // kaito installation in progress
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing Kaito",
                event: 1,
                errorMessage: undefined,
                models: [],
            });
            poller.onProgress((state) => {
                if (state.status === "succeeded") {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Installing Kaito succeeded",
                        event: 4,
                        errorMessage: undefined,
                        models: listKaitoSupportedModels(),
                    });
                } else if (state.status === "failed") {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Installing Kaito failed",
                        event: 3,
                        errorMessage: state.error?.message,
                        models: [],
                    });
                }
            });
            await poller.pollUntilDone();
        } catch (ex) {
            const errorMessage = isInvalidTemplateDeploymentError(ex)
                ? getInvalidTemplateErrorMessage(ex)
                : getErrorMessage(ex);
            vscode.window.showErrorMessage(`Error installing Kaito addon for ${this.clusterName}: ${errorMessage}`);
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing Kaito failed",
                event: 3,
                errorMessage: ex instanceof Error ? ex.message : String(ex),
                models: [],
            });
        }
    }
}

function getInvalidTemplateErrorMessage(ex: InvalidTemplateDeploymentRestError): string {
    const innerDetails = ex.details.error?.details || [];
    if (innerDetails.length > 0) {
        const details = innerDetails.map((d) => `${d.code}: ${d.message}`).join("\n");
        return `Invalid template:\n${details}`;
    }

    const innerError = ex.details.error?.message || "";
    if (innerError) {
        return `Invalid template:\n${innerError}`;
    }

    return `Invalid template: ${getErrorMessage(ex)}`;
}

type InvalidTemplateDeploymentRestError = RestError & {
    details: {
        error?: {
            code: "InvalidTemplateDeployment";
            message?: string;
            details?: {
                code?: string;
                message?: string;
            }[];
        };
    };
};

function isInvalidTemplateDeploymentError(ex: unknown): ex is InvalidTemplateDeploymentRestError {
    return isRestError(ex) && ex.code === "InvalidTemplateDeployment";
}

function isRestError(ex: unknown): ex is RestError {
    return typeof ex === "object" && ex !== null && ex.constructor.name === "RestError";
}

function listKaitoSupportedModels(): ModelDetails[] {
    return kaitoSupporterModel.modelDetails.map((model) => ({
        ...model,
        minimumGpu: Number(model.minimumGpu),
    }));
}
