import { BasePanel, PanelDataProvider } from "./BasePanel";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoModels";
import { InitialState } from "../webview-contract/webviewDefinitions/kaitoModels";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { tmpdir } from "os";
import { writeFileSync } from "fs";
import { join } from "path";
import { DefaultAzureCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { longRunning } from "../commands/utils/host";

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
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
    }
    private cancelToken: boolean = false;
    private checkingGPU: boolean = false;
    getTitle(): string {
        return `Create KAITO Workspace`;
    }
    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            modelName: "",
            workspaceExists: false,
            resourceReady: false,
            inferenceReady: false,
            workspaceReady: false,
            age: 0,
        };
    }
    cancel() {
        this.cancelToken = true;
    }
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
            cancelRequest: () => {
                this.cancel();
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
    parseGPU(gpuRequirement: string): [string, number] {
        const regex = /^Standard_NC(\d+)(ads_A100_v4|s_v3)$/;
        const match = gpuRequirement.match(regex);
        if (match) {
            const cpus = parseInt(match[1], 10);
            let family: string;
            switch (match[2]) {
                case "ads_A100_v4":
                    family = "StandardNCADSA100v4Family";
                    break;
                case "s_v3":
                    family = "standardNCSv3Family";
                    break;
                default:
                    throw new Error("Unknown gpu format");
            }

            return [family, cpus];
        } else {
            throw new Error("Unknown gpu format");
        }
    }

    private async handleDeployKaitoRequest(
        model: string,
        yaml: string,
        gpu: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        this.cancelToken = false;
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
                    const credential = new DefaultAzureCredential();
                    const computeClient = new ComputeManagementClient(credential, this.subscriptionId);
                    const containerServiceClient = new ContainerServiceClient(credential, this.subscriptionId);
                    const cluster = await containerServiceClient.managedClusters.get(
                        this.resourceGroupName,
                        this.clusterName,
                    );
                    const quotas = computeClient.usageOperations.list(cluster.location);
                    let foundQuota = null;
                    for await (const quota of quotas) {
                        if (quota.name.value === gpuFamily) {
                            foundQuota = quota;
                            break;
                        }
                    }
                    if (!foundQuota || !(foundQuota.currentValue + requiredCPUs <= foundQuota.limit)) {
                        vscode.window
                            .showErrorMessage(
                                `Your current Azure subscription doesn't have enough quota to deploy this model, proceed to request a quota increase.`,
                                "Learn More",
                            )
                            .then((selection) => {
                                if (selection === "Learn More") {
                                    vscode.env.openExternal(
                                        vscode.Uri.parse(
                                            "https://learn.microsoft.com/en-us/azure/quotas/quickstart-increase-quota-portal",
                                        ),
                                    );
                                }
                            });
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
        this.handleUpdateStateRequest(model, webview);
        let progress = await this.getProgress(model);
        while (!this.nullIsFalse(progress.workspaceReady) && !this.cancelToken) {
            await this.handleUpdateStateRequest(model, webview);
            progress = await this.getProgress(model);
        }
        if (this.cancelToken) {
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
        webview.postDeploymentProgressUpdate({
            clusterName: this.clusterName,
            modelName: "",
            workspaceExists: false,
            resourceReady: null,
            inferenceReady: null,
            workspaceReady: null,
            age: 0,
        });
    }
    convertAgeToMinutes(creationTimestamp: string): number {
        const createdTime = new Date(creationTimestamp);
        const currentTime = new Date();
        const differenceInMilliseconds = currentTime.getTime() - createdTime.getTime();
        const differenceInMinutes = Math.floor(differenceInMilliseconds / 1000 / 60);
        return differenceInMinutes;
    }
    statusToBoolean(status: string): boolean {
        if (status === "True") {
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
        }
        const data = JSON.parse(kubectlresult.result.stdout);
        const conditions: Array<{ type: string; status: string }> = data.status?.conditions || [];
        let resourceReady = null;
        let inferenceReady = null;
        let workspaceReady = null;
        conditions.forEach(({ type, status }) => {
            switch (type) {
                case "ResourceReady":
                    resourceReady = this.statusToBoolean(status);
                    break;
                case "WorkspaceReady":
                    workspaceReady = this.statusToBoolean(status);
                    break;
                case "InferenceReady":
                    inferenceReady = this.statusToBoolean(status);
                    break;
            }
        });
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

    private async handleUpdateStateRequest(model: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `get workspace workspace-${model} -o json`;
        let kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(
                    `There was an error connecting to the workspace. ${kubectlresult.error}`,
                );
                webview.postDeploymentProgressUpdate({
                    clusterName: this.clusterName,
                    modelName: "",
                    workspaceExists: false,
                    resourceReady: null,
                    inferenceReady: null,
                    workspaceReady: null,
                    age: 0,
                });
                return;
            }
        }
        const data = JSON.parse(kubectlresult.result.stdout);
        const conditions: Array<{ type: string; status: string }> = data.status?.conditions || [];
        let resourceReady = null;
        let inferenceReady = null;
        let workspaceReady = null;

        conditions.forEach((condition) => {
            if (condition.type === "ResourceReady") {
                resourceReady = this.statusToBoolean(condition.status);
            } else if (condition.type === "WorkspaceReady") {
                workspaceReady = this.statusToBoolean(condition.status);
            } else if (condition.type === "InferenceReady") {
                inferenceReady = this.statusToBoolean(condition.status);
            }
        });

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
