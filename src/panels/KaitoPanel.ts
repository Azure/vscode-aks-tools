import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { GenericResource, ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksClient, getFeatureClient, getResourceManagementClient } from "../commands/utils/arm";
import { Errorable, failed, getErrorMessage } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaito";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { l10n } from "vscode";
const MAX_RETRY = 3;
let RETRY_COUNT = 0;

export class KaitoPanel extends BasePanel<"kaito"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaito", {
            kaitoInstallProgressUpdate: null,
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
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly newtarget: unknown,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.featureClient = getFeatureClient(sessionProvider, this.subscriptionId);
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.containerServiceClient = getAksClient(sessionProvider, this.subscriptionId);
        this.filterKaitoPodNames = filterKaitoPodNames;
        this.newtarget = newtarget;
    }
    getTitle(): string {
        return l10n.t(`Install KAITO`);
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
            generateWorkspaceRequest: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            installKaitoRequest: () => {
                this.handleKaitoInstallation(webview);
            },
            generateWorkspaceRequest: () => {
                this.handleGenerateWorkspaceRequest();
            },
        };
    }

    private async handleGenerateWorkspaceRequest() {
        vscode.commands.executeCommand("aks.aksKaitoCreateCRD", this.newtarget);
    }

    private async handleKaitoInstallation(webview: MessageSink<ToWebViewMsgDef>) {
        // Get current json
        const currentJson = await longRunning(l10n.t(`Get current cluster information.`), () => {
            return this.resourceManagementClient.resources.getById(this.armId, "2023-08-01");
        });

        // Prevent KAITO installation on automatic clusters
        const skuName = currentJson.sku?.name;
        if (skuName === "Automatic") {
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Automatic Cluster Detected",
                event: 3,
                errorMessage: l10n.t(
                    "KAITO cannot be installed on automatic clusters. Please try installing KAITO on a standard cluster.",
                ),
            });
            return;
        }

        // Get the feature registration state
        const getFeatureClientRegisterState = await longRunning(
            l10n.t(`Getting the AIToolchainOperator registration state.`),
            () => {
                return this.featureClient.features.get("Microsoft.ContainerService", "AIToolchainOperatorPreview");
            },
        );

        if (getFeatureClientRegisterState.properties?.state !== "Registered") {
            // Register the feature
            const featureRegistrationPoller = await longRunning(l10n.t(`Registering the AIToolchainOperator.`), () => {
                return this.featureClient.features.register(
                    "Microsoft.ContainerService",
                    "AIToolchainOperatorPreview",
                    {},
                );
            });

            if (featureRegistrationPoller.properties?.state !== "Registered") {
                await longRunning(l10n.t(`Waiting for the AIToolchainOperator registration to complete.`), () => {
                    return this.registerKaitoFeature(webview);
                });
            }
        }

        // Install kaito enablement
        const kaitoInstallationResult = await longRunning(
            l10n.t(`Enabling the KAITO for cluster '{0}'.`, this.clusterName),
            () => {
                return this.handleKaitoInstallationLogic(currentJson, webview);
            },
        );

        if (kaitoInstallationResult && failed(kaitoInstallationResult)) {
            vscode.window.showErrorMessage(
                l10n.t(`Error installing KAITO addon for {0}: {1}`, this.clusterName, kaitoInstallationResult.error),
            );
            return;
        }
        // Installation should be either failed or completed at this point
        // Messaging and error handling resides in the above called helper functions
    }

    private async handleKaitoInstallationLogic(
        currentJson: GenericResource,
        webview: MessageSink<ToWebViewMsgDef>,
    ): Promise<Errorable<string> | undefined> {
        // Install kaito enablement
        const managedClusterSpec: ManagedCluster = {
            location: currentJson.location!,
            aiToolchainOperatorProfile: { enabled: true },
            oidcIssuerProfile: { enabled: true },
        };

        try {
            const poller = await longRunning("", () => {
                return this.containerServiceClient.managedClusters.beginCreateOrUpdate(
                    this.resourceGroupName,
                    this.clusterName,
                    managedClusterSpec,
                );
            });
            // kaito installation in progress
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing KAITO",
                event: 1,
                errorMessage: undefined,
            });
            poller.onProgress((state) => {
                if (state.status === "succeeded") {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: l10n.t("Installing KAITO succeeded"),
                        event: 4,
                        errorMessage: undefined,
                    });
                } else if (state.status === "failed") {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Installing KAITO failed",
                        event: 3,
                        errorMessage: state.error?.message,
                    });
                }
            });
            await poller.pollUntilDone();

            return { succeeded: true, result: "KAITO installation logic completed successfully" };
        } catch (ex) {
            const errorMessage = isInvalidTemplateDeploymentError(ex)
                ? getInvalidTemplateErrorMessage(ex)
                : getErrorMessage(ex);

            // Retry the operation
            if (RETRY_COUNT < MAX_RETRY) {
                RETRY_COUNT++;
                const answer = await vscode.window.showErrorMessage(
                    l10n.t(`Error installing KAITO addon for {0}: {1}`, this.clusterName, errorMessage),
                    { modal: true },
                    l10n.t("Retry"),
                );

                // Here the retry logic exist
                if (answer === "Retry") {
                    this.handleKaitoInstallation(webview);
                }
            }

            if (RETRY_COUNT >= MAX_RETRY) {
                vscode.window.showErrorMessage(
                    l10n.t(`Error installing KAITO addon for {0}: {1}`, this.clusterName, errorMessage),
                );
            }

            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing KAITO failed",
                event: 3,
                errorMessage: ex instanceof Error ? ex.message : String(ex),
            });

            return { succeeded: false, error: ex instanceof Error ? ex.message : String(ex) };
        }
    }

    private async registerKaitoFeature(webview: MessageSink<ToWebViewMsgDef>) {
        // Let's start delay for 3 mins
        await longRunning(l10n.t(`Waiting for the AIToolchainOperator registration to complete.`), async () => {
            await new Promise((resolve) => setTimeout(resolve, 180000)); // 3 minutes = 180000 ms
        });
        // Get the feature registration state
        const getFeatureClientRegisterStateAfterDelay = await longRunning(
            l10n.t(`Getting the AIToolchainOperator registration state.`),
            () => {
                return this.featureClient.features.get("Microsoft.ContainerService", "AIToolchainOperatorPreview");
            },
        );

        if (getFeatureClientRegisterStateAfterDelay.properties?.state !== "Registered") {
            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing KAITO",
                event: 3,
                errorMessage: "Failed to register feature",
            });
            return;
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
