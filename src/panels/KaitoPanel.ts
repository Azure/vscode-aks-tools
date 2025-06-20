import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { FeatureClient } from "@azure/arm-features";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { GenericResource, ResourceManagementClient } from "@azure/arm-resources";
import { RestError } from "@azure/storage-blob";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import {
    getAksClient,
    getAuthorizationManagementClient,
    getFeatureClient,
    getManagedServiceIdentityClient,
    getResourceManagementClient,
} from "../commands/utils/arm";
import { getManagedCluster } from "../commands/utils/clusters";
import { Errorable, failed, getErrorMessage } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { createFederatedCredential, getIdentity } from "../commands/utils/managedServiceIdentity";
import { createRoleAssignment } from "../commands/utils/roleAssignments";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaito";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { isPodReady, getKaitoPods } from "./utilities/KaitoHelpers";
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
        readonly newtarget: unknown,
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

        // install Kaito Federated Credentials and role Assignments
        try {
            const installKaitoFederatedCredentialsAndRoleAssignments = await longRunning(
                l10n.t(`Installing KAITO Federated Credentials and role Assignments.`),
                () => {
                    return this.installKaitoComponents();
                },
            );

            if (failed(installKaitoFederatedCredentialsAndRoleAssignments)) {
                //installing federated credentionals failed
                const errorMessage = installKaitoFederatedCredentialsAndRoleAssignments.error;
                vscode.window.showErrorMessage(
                    l10n.t(`Error installing KAITO Federated Credentials and role Assignments: {0}`, errorMessage),
                );
                webview.postKaitoInstallProgressUpdate({
                    operationDescription: "Installing Federated Credentials Failed",
                    event: 3,
                    errorMessage: errorMessage,
                });
                return;
            }

            //kaito installation succeeded
            webview.postKaitoInstallProgressUpdate({
                operationDescription: l10n.t("Installing KAITO succeeded"),
                event: 4,
                errorMessage: undefined,
            });
        } catch (ex) {
            vscode.window.showErrorMessage(
                l10n.t(`Error installing KAITO Federated Credentials and role Assignments: {0}`, getErrorMessage(ex)),
            );
        }
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
                        operationDescription: "KAITO Federated Credentials and role Assignments",
                        event: 1,
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

    private async installKaitoComponents(): Promise<Errorable<string>> {
        const clusterInfo = await getManagedCluster(
            this.sessionProvider,
            this.subscriptionId,
            this.resourceGroupName,
            this.clusterName,
        );

        if (failed(clusterInfo)) {
            vscode.window.showErrorMessage(l10n.t(`Error getting managed cluster info: {0}`, clusterInfo.error));
            return { succeeded: false, error: clusterInfo.error };
        }

        const roleAssignmentsResult = await this.installKaitoRoleAssignments(
            clusterInfo.result.nodeResourceGroup!,
            this.subscriptionId,
            this.resourceGroupName,
            this.clusterName,
        );

        //halt installation if role assignments creation failed
        if (failed(roleAssignmentsResult)) {
            return { succeeded: false, error: roleAssignmentsResult.error };
        }

        const aksOidcIssuerUrl = clusterInfo.result.oidcIssuerProfile?.issuerURL;
        if (!aksOidcIssuerUrl) {
            vscode.window.showErrorMessage(
                l10n.t(`Error getting aks oidc issuer url, oidc issuer url is undefined/null/empty`),
            );
            return {
                succeeded: false,
                error: "Error getting aks oidc issuer url, oidc issuer url is undefined/null/empty",
            };
        }

        const kaitoFederatedCredentialsResult = await this.installKaitoFederatedCredentials(
            clusterInfo.result.nodeResourceGroup!,
            this.clusterName,
            aksOidcIssuerUrl,
        );

        //halt installation if federated credentials installation failed
        if (failed(kaitoFederatedCredentialsResult)) {
            return { succeeded: false, error: kaitoFederatedCredentialsResult.error };
        }

        //kubectl rollout restart deployment kaito-gpu-provisioner -n kube-system
        const command = `rollout restart deployment kaito-gpu-provisioner -n kube-system`;
        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            vscode.window.showErrorMessage(l10n.t(`Error restarting kaito-gpu-provisioner: {0}`, kubectlresult.error));
            return { succeeded: false, error: kubectlresult.error };
        }

        // waiting for gpu provisioner to be ready, which usually takes around 30 seconds
        await new Promise((resolve) => setTimeout(resolve, 35000));
        let gpuProvisionerReady = false;
        const kaitoPods = await getKaitoPods(
            this.sessionProvider,
            this.kubectl,
            this.subscriptionId,
            this.resourceGroupName,
            this.clusterName,
        );
        const gpuProvisionerPod = kaitoPods.find((pod) =>
            pod.imageName.startsWith("mcr.microsoft.com/aks/kaito/gpu-provisioner"),
        );
        if (gpuProvisionerPod === undefined) {
            vscode.window.showErrorMessage(l10n.t(`GPU Provisioner not found`));
            return { succeeded: false, error: "GPU Provisioner not found" };
        }

        // If the pod is already ready, we can skip the loop
        if (
            await isPodReady(
                gpuProvisionerPod.nameSpace,
                gpuProvisionerPod.podName,
                this.kubectl,
                this.kubeConfigFilePath,
            )
        ) {
            gpuProvisionerReady = true;
        } else {
            // If the pod is not ready, we will poll readiness for the next 2 minutes
            const endTime = Date.now() + 120000;
            while (Date.now() < endTime) {
                if (
                    await isPodReady(
                        gpuProvisionerPod.nameSpace,
                        gpuProvisionerPod.podName,
                        this.kubectl,
                        this.kubeConfigFilePath,
                    )
                ) {
                    gpuProvisionerReady = true;
                    break;
                }
                // 5 second delay between checks
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
        }

        if (!gpuProvisionerReady) {
            vscode.window.showErrorMessage(l10n.t(`GPU Provisioner is not ready`));
            return { succeeded: false, error: "GPU Provisioner is not ready" };
        }

        return { succeeded: true, result: "KAITO components installed successfully" };
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

    private async installKaitoRoleAssignments(
        mcResourceGroup: string,
        subscriptionId: string,
        resourceGroupName: string,
        clusterName: string,
    ): Promise<Errorable<string>> {
        // get principal id of managed service identity
        const identityName = `ai-toolchain-operator-${clusterName}`;
        const identityResult = await getIdentity(this.managedServiceIdentityClient, mcResourceGroup, identityName);

        if (failed(identityResult)) {
            vscode.window.showErrorMessage(l10n.t(`Error getting identity: {0}`, identityResult.error));
            return { succeeded: false, error: identityResult.error };
        }

        const roleAssignment = await createRoleAssignment(
            this.authorizationClient,
            subscriptionId,
            identityResult.result.principalId!,
            "b24988ac-6180-42a0-ab88-20f7382dd24c", // contributor role id: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles#general
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
        );

        if (failed(roleAssignment)) {
            // Don't cancel installation if role assignments already exist, user could be attempting to reinstall
            if (roleAssignment.error?.includes("already exists")) {
                return { succeeded: true, result: "Role assignments already exist" };
            } else {
                // cancel installation only if there is an alternate error that conflicts with further steps
                return { succeeded: false, error: roleAssignment.error };
            }
        }
        return { succeeded: true, result: "Role assignments created successfully" };
    }

    private async installKaitoFederatedCredentials(
        nodeResourceGroup: string,
        clusterName: string,
        aksOidcIssuerUrl: string,
    ): Promise<Errorable<string>> {
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
            return { succeeded: false, error: result.error };
        } else {
            return { succeeded: true, result: "Federated credentials created successfully" };
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
