import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksClient, getComputeManagementClient } from "../commands/utils/arm";
import { failed } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoModels";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { PagedAsyncIterableIterator, PageSettings } from "@azure/core-paging";
import { Usage } from "@azure/arm-compute";
import { kaitoPodStatus, getKaitoPods, convertAgeToMinutes, deployModel } from "./utilities/KaitoHelpers";
import { existsSync } from "fs";

enum GpuFamilies {
    NCSv3Family = "s_v3",
    NCADSA100v4Family = "ads_A100_v4",
}

export class KaitoModelsPanel extends BasePanel<"kaitoModels"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaitoModels", {
            deploymentProgressUpdate: null,
        });
    }
}

export class KaitoModelsPanelDataProvider implements PanelDataProvider<"kaitoModels"> {
    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly armId: string,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly newtarget: unknown,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
        this.sessionProvider = sessionProvider;
        this.newtarget = newtarget;
    }
    // When true, will break the loop that is watching the workspace progress
    // private cancelToken: boolean = false;
    private cancelTokens: Map<string, boolean> = new Map();
    cancel(model: string) {
        this.cancelTokens.set(model, true);
    }

    // This is set to true while pre-deployment checks are being performed
    private checksInProgress: boolean = false;

    getTitle(): string {
        return `Create KAITO Workspace`;
    }
    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            modelName: "",
            workspaceExists: false,
            resourceReady: null,
            inferenceReady: null,
            workspaceReady: null,
            age: 0,
        } as InitialState;
    }
    getTelemetryDefinition(): TelemetryDefinition<"kaitoModels"> {
        return {
            generateCRDRequest: true,
            deployKaitoRequest: true,
            resetStateRequest: false,
            cancelRequest: false,
            kaitoManageRedirectRequest: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            generateCRDRequest: (params) => {
                this.handleGenerateCRDRequest(params.model);
            },
            deployKaitoRequest: (params) => {
                this.handleDeployKaitoRequest(params.model, params.yaml, params.gpu, webview);
            },
            resetStateRequest: () => {
                this.handleResetStateRequest(webview);
            },
            cancelRequest: (params) => {
                this.cancel(params.model);
            },
            kaitoManageRedirectRequest: () => {
                this.handleKaitoManageRedirectRequest();
            },
        };
    }

    private async handleKaitoManageRedirectRequest() {
        vscode.commands.executeCommand("aks.aksKaitoManage", this.newtarget);
    }
    private async handleGenerateCRDRequest(yaml: string) {
        const doc = await vscode.workspace.openTextDocument({
            content: yaml,
            language: "yaml",
        });
        vscode.window.showTextDocument(doc);
    }

    nullIsFalse(value: boolean | null): boolean {
        return value ?? false;
    }

    // Returns [family, cpus] where family is the family of the gpu and cpus is the number of cpus
    parseGPU(gpuRequirement: string): [string, number] {
        const regex = /^Standard_NC(\d+)(ads_A100_v4|s_v3)$/;
        const match = gpuRequirement.match(regex);
        const gpuError = new Error("Unknown gpu format");
        if (match) {
            const cpus = parseInt(match[1], 10);
            let family: string;
            // match[2] is the gpu family
            switch (match[2]) {
                case GpuFamilies.NCADSA100v4Family:
                    family = "StandardNCADSA100v4Family";
                    break;
                case GpuFamilies.NCSv3Family:
                    family = "standardNCSv3Family";
                    break;
                default:
                    throw gpuError;
            }
            return [family, cpus];
        } else {
            throw gpuError;
        }
    }

    // Helper function for workspace readiness
    getConditions(conditions: Array<{ type: string; status: string }>) {
        let resourceReady = null;
        let inferenceReady = null;
        let workspaceReady = null;
        conditions.forEach(({ type, status }) => {
            switch (type.toLowerCase()) {
                case "resourceready":
                    resourceReady = this.statusToBoolean(status);
                    break;
                case "workspacesucceeded":
                    workspaceReady = this.statusToBoolean(status);
                    break;
                case "inferenceready":
                    inferenceReady = this.statusToBoolean(status);
                    break;
            }
        });
        return { resourceReady, inferenceReady, workspaceReady };
    }

    async promptForQuotaIncrease() {
        const selection = await vscode.window.showErrorMessage(
            `Your current Azure subscription doesn't have enough quota to deploy this model. Proceed to request a quota increase.`,
            "Learn More",
        );

        if (selection === "Learn More") {
            vscode.env.openExternal(
                vscode.Uri.parse("https://learn.microsoft.com/en-us/azure/quotas/quickstart-increase-quota-portal"),
            );
        }
    }

    private async findMatchingQuota(
        quotas: PagedAsyncIterableIterator<Usage, Usage[], PageSettings>,
        gpuFamily: string,
    ) {
        for await (const quota of quotas) {
            if (quota.name.value === gpuFamily) {
                return quota;
            }
        }
        return null;
    }

    private isQuotaSufficient(quota: Usage, requiredCPUs: number) {
        return quota.currentValue + requiredCPUs <= quota.limit;
    }

    private handleDeploymentCancellation(model: string) {
        vscode.window.showErrorMessage(`Deployment cancelled for ${model}`);
        this.checksInProgress = false;
    }

    // This function checks quota & existence of workspace, then deploys model
    private async handleDeployKaitoRequest(
        model: string,
        yaml: string,
        gpu: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        this.cancelTokens.set(model, false);
        this.handleResetStateRequest(webview);
        // This prevents the user from redeploying while pre-deployment checks are being performed
        if (this.checksInProgress) {
            return;
        }
        try {
            this.checksInProgress = true;
            let quotaAvailable = false;
            let getResult = null;
            let readyStatus = { kaitoWorkspaceReady: false, kaitoGPUProvisionerReady: false };
            await longRunning(`Validating KAITO workspace status`, async () => {
                // Returns an object with the status of the kaito pods
                const kaitoPods = await getKaitoPods(
                    this.sessionProvider,
                    this.kubectl,
                    this.subscriptionId,
                    this.resourceGroupName,
                    this.clusterName,
                );
                readyStatus = await kaitoPodStatus(this.clusterName, kaitoPods, this.kubectl, this.kubeConfigFilePath);
            });
            if (!readyStatus.kaitoWorkspaceReady || !readyStatus.kaitoGPUProvisionerReady) {
                this.checksInProgress = false;
                return;
            }
            // Catches if the user cancelled deployment at this point
            if (this.cancelTokens.get(model)) {
                this.handleDeploymentCancellation(model);
                return;
            }
            await longRunning(`Checking if workspace exists...`, async () => {
                const getCommand = `get workspace workspace-${model}`;
                getResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, getCommand);
            });
            if (getResult === null || failed(getResult)) {
                // Deployment cancellation check
                if (this.cancelTokens.get(model)) {
                    this.handleDeploymentCancellation(model);
                    return;
                }
                await longRunning(`Verifying available subscription quota for deployment...`, async () => {
                    const [gpuFamily, requiredCPUs] = this.parseGPU(gpu);
                    void requiredCPUs;
                    const computeClient = getComputeManagementClient(this.sessionProvider, this.subscriptionId);
                    const containerServiceClient = getAksClient(this.sessionProvider, this.subscriptionId);
                    const cluster = await containerServiceClient.managedClusters.get(
                        this.resourceGroupName,
                        this.clusterName,
                    );
                    const quotas = computeClient.usageOperations.list(cluster.location);
                    let foundQuota = null;
                    foundQuota = await this.findMatchingQuota(quotas, gpuFamily);
                    if (!foundQuota || !this.isQuotaSufficient(foundQuota, requiredCPUs)) {
                        this.promptForQuotaIncrease();
                    } else {
                        quotaAvailable = true;
                    }
                });
            } else {
                quotaAvailable = true;
            }
            if (!quotaAvailable) {
                this.checksInProgress = false;
                return;
            }

            // Deployment cancellation check
            if (this.cancelTokens.get(model)) {
                this.handleDeploymentCancellation(model);
                return;
            }
            // Deploying model
            const deploymentResult = await deployModel(yaml, this.kubectl, this.kubeConfigFilePath);
            if (failed(deploymentResult)) {
                vscode.window.showErrorMessage(`Error deploying 'workspace-${model}': ${deploymentResult.error}`);
                this.checksInProgress = false;
                return;
            }
            // Final checksInProgress set to false to allow for future deployments
            this.checksInProgress = false;
        } catch (error) {
            this.checksInProgress = false;
            vscode.window.showErrorMessage(`Error during deployment: ${error}`);
        }
        // end state updates if user cancelled out of view
        if (this.cancelTokens.get(model)) {
            vscode.window.showErrorMessage(`Deployment cancelled for ${model}`);
            return;
        }
        // if cancel token is set for any other model, just return maybe?
        this.updateProgress(model, webview);
        let progress = await this.getProgress(model);

        // Continuously polls deployment progress until completion, cancellation, or panel disposal.
        while (
            !this.nullIsFalse(progress.workspaceReady) &&
            !this.cancelTokens.get(model) &&
            existsSync(this.kubeConfigFilePath)
        ) {
            // Error handling is done via updateProgress
            progress = await this.updateProgress(model, webview);
            // 5 second delay between each check
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        if (this.cancelTokens.get(model)) {
            await this.handleResetStateRequest(webview);
        } else {
            await this.updateProgress(model, webview);
        }
    }

    private async handleResetStateRequest(webview: MessageSink<ToWebViewMsgDef>) {
        webview.postDeploymentProgressUpdate(this.getInitialState());
    }

    statusToBoolean(status: string): boolean {
        if (status.toLowerCase() === "true") {
            return true;
        }
        return false;
    }

    // Returns current state of workspace associated with given model
    private async getProgress(model: string): Promise<InitialState> {
        const command = `get workspace workspace-${model} -o json`;
        let kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                // Error message only produced if kubeconfig file is still present (it's removed upon panel closing)
                // This is to prevent error messages from appearing when the user closes the panel
                if (existsSync(this.kubeConfigFilePath)) {
                    vscode.window.showErrorMessage(
                        `There was an error connecting to the workspace. ${kubectlresult.error}`,
                    );
                }
                return this.getInitialState();
            }
        }
        const data = JSON.parse(kubectlresult.result.stdout);
        const conditions: Array<{ type: string; status: string }> = data.status?.conditions || [];
        const { resourceReady, inferenceReady, workspaceReady } = this.getConditions(conditions);
        return {
            clusterName: this.clusterName,
            modelName: model,
            workspaceExists: true,
            resourceReady: resourceReady,
            inferenceReady: inferenceReady,
            workspaceReady: workspaceReady,
            age: convertAgeToMinutes(data.metadata?.creationTimestamp),
        } as InitialState;
    }

    // Posts current state to webview & returns the value
    private async updateProgress(model: string, webview: MessageSink<ToWebViewMsgDef>) {
        const progress = await this.getProgress(model);
        webview.postDeploymentProgressUpdate(progress);
        // if modelName is empty, it means getProgress failed
        if (progress.modelName === "") {
            this.cancelTokens.set(model, true);
        }
        return progress;
    }
}
