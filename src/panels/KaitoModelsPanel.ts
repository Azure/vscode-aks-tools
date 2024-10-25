import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
    }
    // When true, will break the loop that is watching the workspace progress
    // private cancelToken: boolean = false;
    private cancelTokens: Map<string, boolean> = new Map();
    cancel(model: string) {
        this.cancelTokens.set(model, true);
    }
    // This is set to true while quota information is being fetched
    private checkingGPU: boolean = false;

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
    // cancel() {
    //     this.cancelToken = true;
    // }
    getTelemetryDefinition(): TelemetryDefinition<"kaitoModels"> {
        return {
            generateCRDRequest: true,
            deployKaitoRequest: true,
            workspaceExistsRequest: false,
            updateStateRequest: false,
            resetStateRequest: false,
            cancelRequest: false,
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
            workspaceExistsRequest: (params) => {
                this.handleWorkspaceExistsRequest(params.model);
            },
            updateStateRequest: (params) => {
                this.handleUpdateStateRequest(params.model, webview);
            },
            resetStateRequest: () => {
                this.handleResetStateRequest(webview);
            },
            cancelRequest: (params) => {
                this.cancel(params.model);
            },
        };
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

    // This function checks quota & existence of workspace, then deploys model
    private async handleDeployKaitoRequest(
        model: string,
        yaml: string,
        gpu: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        this.cancelTokens.set(model, false);
        this.handleResetStateRequest(webview);

        // Resetting cancelToken
        // this.cancelToken = false;
        // This prevents the user from redeploying while quota is being checked
        if (this.checkingGPU) {
            return;
        }
        try {
            this.checkingGPU = true;
            let quotaAvailable = false;
            let getResult = null;
            await longRunning(`Checking if workspace exists...`, async () => {
                const getCommand = `get workspace workspace-${model}`;
                getResult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, getCommand);
            });
            if (getResult === null || failed(getResult)) {
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

            this.checkingGPU = false;
            if (!quotaAvailable) {
                return;
            }
            const tempFilePath = join(tmpdir(), `kaito-deployment-${Date.now()}.yaml`);
            writeFileSync(tempFilePath, yaml, "utf8");
            const command = `apply -f ${tempFilePath}`;
            const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(`Error during deployment: ${kubectlresult.error}`);
                return;
            }
        } catch (error) {
            this.checkingGPU = false;
            vscode.window.showErrorMessage(`Error during deployment: ${error}`);
        }
        this.cancelTokens.set(model, false);
        this.handleUpdateStateRequest(model, webview);
        let progress = await this.getProgress(model);
        while (!this.nullIsFalse(progress.workspaceReady) && !this.cancelTokens.get(model)) {
            await this.handleUpdateStateRequest(model, webview);
            progress = await this.getProgress(model);
        }
        if (this.cancelTokens.get(model)) {
            await this.handleResetStateRequest(webview);
        } else {
            await this.handleUpdateStateRequest(model, webview);
        }
    }

    private async handleWorkspaceExistsRequest(model: string) {
        const command = `get workspace ${model} -w`;
        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            return false;
        } else {
            return true;
        }
    }
    private async handleResetStateRequest(webview: MessageSink<ToWebViewMsgDef>) {
        webview.postDeploymentProgressUpdate(this.getInitialState());
    }
    convertAgeToMinutes(creationTimestamp: string): number {
        const createdTime = new Date(creationTimestamp);
        const currentTime = new Date();
        const differenceInMilliseconds = currentTime.getTime() - createdTime.getTime();
        const differenceInMinutes = Math.floor(differenceInMilliseconds / 1000 / 60);
        return differenceInMinutes;
    }
    statusToBoolean(status: string): boolean {
        if (status.toLowerCase() === "true") {
            return true;
        }
        return false;
    }
    private async getProgress(model: string): Promise<InitialState> {
        const command = `get workspace workspace-${model} -o json`;
        let kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(kubectlresult.error);
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
            age: this.convertAgeToMinutes(data.metadata?.creationTimestamp),
        } as InitialState;
    }

    // Returns current state of workspace associated with given model
    private async handleUpdateStateRequest(model: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `get workspace workspace-${model} -o json`;
        let kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(
                    `There was an error connecting to the workspace. ${kubectlresult.error}`,
                );
                webview.postDeploymentProgressUpdate(this.getInitialState());
                this.cancelTokens.set(model, true);
                return;
            }
        }
        const data = JSON.parse(kubectlresult.result.stdout);
        const conditions: Array<{ type: string; status: string }> = data.status?.conditions || [];
        const { resourceReady, inferenceReady, workspaceReady } = this.getConditions(conditions);

        webview.postDeploymentProgressUpdate({
            clusterName: this.clusterName,
            modelName: model,
            workspaceExists: true,
            resourceReady: resourceReady,
            inferenceReady: inferenceReady,
            workspaceReady: workspaceReady,
            age: this.convertAgeToMinutes(data.metadata?.creationTimestamp),
        });
        return;
    }
}
