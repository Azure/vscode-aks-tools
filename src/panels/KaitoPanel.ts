import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import kaitoSupporterModel from "../../resources/kaitollmconfig/kaitollmconfig.json";
import { ReadyAzureSessionProvider } from "../auth/types";
import {
    getAksClient,
    getAuthorizationManagementClient,
    getFeatureClient,
    getManagedServiceIdentityClient,
    getResourceManagementClient,
} from "../commands/utils/arm";
import { getManagedCluster } from "../commands/utils/clusters";
import { failed, getErrorMessage } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { createFederatedCredential, getIdentity } from "../commands/utils/managedServiceIdentity";
import { createRoleAssignment } from "../commands/utils/roleAssignments";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    ModelDetails,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/kaito";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";

const MAX_RETRY = 3;
let RETRY_COUNT = 0;

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
    private readonly authorizationClient: AuthorizationManagementClient;
    private readonly managedServiceIdentityClient: ManagedServiceIdentityClient;

    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly armId: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly filterKaitoPodNames: string[],
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.featureClient = getFeatureClient(sessionProvider, this.subscriptionId);
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.containerServiceClient = getAksClient(sessionProvider, this.subscriptionId);
        this.authorizationClient = getAuthorizationManagementClient(sessionProvider, this.subscriptionId);
        this.managedServiceIdentityClient = getManagedServiceIdentityClient(sessionProvider, this.subscriptionId);
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
        // Get the feature registration state
        const getFeatureClientRegisterState = await longRunning(
            `Getting the AIToolchainOperator registration state.`,
            () => {
                return this.featureClient.features.get("Microsoft.ContainerService", "AIToolchainOperatorPreview");
            },
        );

        if (getFeatureClientRegisterState.properties?.state !== "Registered") {
            // Register the feature
            const featureRegistrationPoller = await longRunning(`Registering the AIToolchainOperator.`, () => {
                return this.featureClient.features.register(
                    "Microsoft.ContainerService",
                    "AIToolchainOperatorPreview",
                    {},
                );
            });

            if (featureRegistrationPoller.properties?.state !== "Registered") {
                //Let's start delay for 3 mins
                await longRunning(`Waiting for the AIToolchainOperator registration to complete.`, async () => {
                    await new Promise((resolve) => setTimeout(resolve, 200000));
                });
                // Get the feature registration state
                const getFeatureClientRegisterState = await longRunning(
                    `Getting the AIToolchainOperator registration state.`,
                    () => {
                        return this.featureClient.features.get(
                            "Microsoft.ContainerService",
                            "AIToolchainOperatorPreview",
                        );
                    },
                );

                if (getFeatureClientRegisterState.properties?.state !== "Registered") {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Installing Kaito",
                        event: 3,
                        errorMessage: "Failed to register feature",
                        models: [],
                    });
                    return;
                }
            }
        }

        // Get current json
        const currentJson = await longRunning(`Get current cluster information.`, () => {
            return this.resourceManagementClient.resources.getById(this.armId, "2023-08-01");
        });

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
                        operationDescription: "Kaito Federated Credentials and role Assignments",
                        event: 1,
                        errorMessage: undefined,
                        models: [],
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

            // Retry the operation
            if (RETRY_COUNT < MAX_RETRY) {
                RETRY_COUNT++;
                const answer = await vscode.window.showErrorMessage(
                    `Error installing Kaito addon for ${this.clusterName}: ${errorMessage}`,
                    { modal: true },
                    "Retry",
                );
                // Here the retry logic exist
                if (answer === "Retry") {
                    this.handleKaitoInstallation(webview);
                }
            }

            if (RETRY_COUNT >= MAX_RETRY) {
                vscode.window.showErrorMessage(`Error installing Kaito addon for ${this.clusterName}: ${errorMessage}`);
            }

            webview.postKaitoInstallProgressUpdate({
                operationDescription: "Installing Kaito failed",
                event: 3,
                errorMessage: ex instanceof Error ? ex.message : String(ex),
                models: [],
            });
        }

        // install Kaito Federated Credentials and role Assignments
        try {
            await longRunning(`Installing Kaito Federated Credentials and role Assignments.`, async () => {
                const clusterInfo = await getManagedCluster(
                    this.sessionProvider,
                    this.subscriptionId,
                    this.resourceGroupName,
                    this.clusterName,
                );

                if (failed(clusterInfo)) {
                    vscode.window.showErrorMessage(`Error getting managed cluster info: ${clusterInfo.error}`);
                    return;
                }

                await this.installKaitoRoleAssignments(
                    clusterInfo.result.nodeResourceGroup!,
                    this.subscriptionId,
                    this.resourceGroupName,
                    this.clusterName,
                );

                const aksOidcIssuerUrl = clusterInfo.result.oidcIssuerProfile?.issuerURL;
                if (!aksOidcIssuerUrl) {
                    vscode.window.showErrorMessage(`Error getting aks oidc issuer url`);
                    return;
                }
                await this.installKaitoFederatedCredentials(
                    clusterInfo.result.nodeResourceGroup!,
                    this.clusterName,
                    aksOidcIssuerUrl,
                );

                //kubectl rollout restart deployment kaito-gpu-provisioner -n kube-system
                const command = `rollout restart deployment kaito-gpu-provisioner -n kube-system`;
                const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
                if (failed(kubectlresult)) {
                    vscode.window.showErrorMessage(`Error restarting kaito-gpu-provisioner: ${kubectlresult.error}`);
                    return;
                }

                //kaito installation succeeded
                webview.postKaitoInstallProgressUpdate({
                    operationDescription: "Installing Kaito succeeded",
                    event: 4,
                    errorMessage: undefined,
                    models: listKaitoSupportedModels(),
                });
            });
        } catch (ex) {
            vscode.window.showErrorMessage(
                `Error installing Kaito Federated Credentials and role Assignments: ${getErrorMessage(ex)}`,
            );
        }
    }

    private async installKaitoRoleAssignments(
        mcResourceGroup: string,
        subscriptionId: string,
        resourceGroupName: string,
        clusterName: string,
    ) {
        // get principal id of managed service identity
        const identityName = `ai-toolchain-operator-${clusterName}`;
        const identityResult = await getIdentity(this.managedServiceIdentityClient, mcResourceGroup, identityName);

        if (failed(identityResult)) {
            vscode.window.showErrorMessage(`Error getting identity: ${identityResult.error}`);
            return;
        }

        const roleAssignment = await createRoleAssignment(
            this.authorizationClient,
            subscriptionId,
            identityResult.result.principalId!,
            "b24988ac-6180-42a0-ab88-20f7382dd24c", // contributor role id: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#general
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
        );

        if (failed(roleAssignment)) {
            vscode.window.showWarningMessage(
                `Error installing Kaito Federated Credentials and role Assignments: ${roleAssignment.error}`,
            );
            // return;
        }
    }

    private async installKaitoFederatedCredentials(
        nodeResourceGroup: string,
        clusterName: string,
        aksOidcIssuerUrl: string,
    ) {
        const result = await createFederatedCredential(
            this.managedServiceIdentityClient,
            nodeResourceGroup,
            "kaito-federated-identity", // https://learn.microsoft.com/en-us/azure/aks/ai-toolchain-operator#establish-a-federated-identity-credential
            `ai-toolchain-operator-${clusterName}`,
            aksOidcIssuerUrl,
            `system:serviceaccount:kube-system:kaito-gpu-provisioner`,
            "api://AzureADTokenExchange",
        );

        if (failed(result)) {
            vscode.window.showErrorMessage(`Error creating federated credentials: ${result.error}`);
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

function listKaitoSupportedModels(): ModelDetails[] {
    return kaitoSupporterModel.modelDetails.map((model) => ({
        ...model,
        minimumGpu: Number(model.minimumGpu),
    }));
}
