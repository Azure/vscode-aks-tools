import { BasePanel, PanelDataProvider } from "./BasePanel";
import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef, ModelState } from "../webview-contract/webviewDefinitions/kaitoManage";
import { InitialState } from "../webview-contract/webviewDefinitions/kaitoManage";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { failed } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { getConditions, convertAgeToMinutes, deployModel } from "./utilities/KaitoHelpers";
import { filterPodImage } from "../commands/utils/clusters";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksClient } from "../commands/utils/arm";
import { l10n } from "vscode";
export class KaitoManagePanel extends BasePanel<"kaitoManage"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaitoManage", {
            monitorUpdate: null,
        });
    }
}

export class KaitoManagePanelDataProvider implements PanelDataProvider<"kaitoManage"> {
    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly armId: string,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly models: ModelState[],
        readonly newtarget: unknown,
        readonly sessionProvider: ReadyAzureSessionProvider,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
        this.models = models;
        this.newtarget = newtarget;
        this.sessionProvider = sessionProvider;
    }

    getTitle(): string {
        return l10n.t(`Manage Kaito Models`);
    }
    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            models: this.models,
        };
    }
    getTelemetryDefinition(): TelemetryDefinition<"kaitoManage"> {
        return {
            monitorUpdateRequest: false,
            deleteWorkspaceRequest: true,
            redeployWorkspaceRequest: true,
            getLogsRequest: true,
            testWorkspaceRequest: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            monitorUpdateRequest: () => {
                this.handleMonitorUpdateRequest(webview);
            },
            deleteWorkspaceRequest: (params) => {
                this.handleDeleteWorkspaceRequest(params.model, webview);
            },
            redeployWorkspaceRequest: (params) => {
                this.handleRedeployWorkspaceRequest(params.modelName, params.modelYaml, webview);
            },
            getLogsRequest: () => {
                this.handleGetLogsRequest();
            },
            testWorkspaceRequest: (params) => {
                this.handleTestWorkspaceRequest(params.modelName);
            },
        };
    }

    // State tracker for ongoing operations
    private operatingState: Record<string, boolean> = {};
    private async handleDeleteWorkspaceRequest(model: string, webview: MessageSink<ToWebViewMsgDef>) {
        // Prevent multiple operations on the same model
        // Expected to be false unless this function has already been called and is currently in progress
        if (this.operatingState[model]) {
            vscode.window.showErrorMessage(l10n.t(`Operation in progress for '{0}'. Please wait.`, model));
            return;
        }
        this.operatingState[model] = true;
        try {
            await longRunning(`Deleting '${model}'`, async () => {
                const command = `delete workspace ${model}`;
                const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
                if (failed(kubectlresult)) {
                    vscode.window.showErrorMessage(
                        l10n.t(`There was an error deleting '{0}'. {1}`, model, kubectlresult.error),
                    );
                    return;
                }
            });
            vscode.window.showInformationMessage(l10n.t(`'{0}' was deleted successfully`, model));
            await this.updateModels(webview);

            // Delete the node pool associated with the workspace if it exists
            const client = getAksClient(this.sessionProvider, this.subscriptionId);
            for await (const pool of client.agentPools.list(this.resourceGroupName, this.clusterName)) {
                const labels = pool.nodeLabels ?? {};
                const name = pool.name;
                // kaito.sh/workspace:workspaceName is the tag format utilized by Kaito
                if (labels["kaito.sh/workspace"] === model && name) {
                    client.agentPools.beginDeleteAndWait(this.resourceGroupName, this.clusterName, name);
                    break;
                }
            }
        } finally {
            this.operatingState[model] = false;
        }
    }

    // Deletes the workspace and redeploys it
    private async handleRedeployWorkspaceRequest(
        modelName: string,
        modelYaml: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        // Prevent multiple operations on the same model
        // Expected to be false unless this function has already been called and is currently in progress
        if (this.operatingState[modelName]) {
            vscode.window.showErrorMessage(l10n.t(`Operation in progress for '{0}'. Please wait.`, modelName));
            return;
        }
        try {
            // Delete the workspace first (wait for deletion to finish)
            await this.handleDeleteWorkspaceRequest(modelName, webview);
            this.operatingState[modelName] = true;

            // Redeploy the workspace
            await longRunning(`Re-deploying '${modelName}'`, async () => {
                const deploymentResult = await deployModel(modelYaml, this.kubectl, this.kubeConfigFilePath);
                if (failed(deploymentResult)) {
                    vscode.window.showErrorMessage(
                        l10n.t(`Error deploying '{0}': {1}`, modelName, deploymentResult.error),
                    );
                    return;
                }
            });
            vscode.window.showInformationMessage(l10n.t(`'{0}' has been redeployed.`, modelName));
            await this.updateModels(webview);
        } finally {
            this.operatingState[modelName] = false;
        }
    }

    // Updates the current state of models on the cluster
    private async updateModels(webview: MessageSink<ToWebViewMsgDef>) {
        const command = `get workspace -o json`;
        const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(kubectlresult)) {
            webview.postMonitorUpdate({
                clusterName: this.clusterName,
                models: [],
            });
            return;
        }

        const models = [];
        const data = JSON.parse(kubectlresult.result.stdout);
        for (const item of data.items) {
            const conditions: Array<{ type: string; status: string }> = item.status?.conditions || [];
            const { resourceReady, inferenceReady, workspaceReady } = getConditions(conditions);
            // The data below is used to indicate the progress of the active model deployment
            models.push({
                name: item.metadata?.name,
                instance: item.resource?.instanceType,
                resourceReady: resourceReady,
                inferenceReady: inferenceReady,
                workspaceReady: workspaceReady,
                age: convertAgeToMinutes(item.metadata?.creationTimestamp),
            });
        }

        webview.postMonitorUpdate({
            clusterName: this.clusterName,
            models: models,
        });
    }

    private async handleMonitorUpdateRequest(webview: MessageSink<ToWebViewMsgDef>) {
        await this.updateModels(webview);
    }

    // Retrieves the logs from the Kaito workspace and outputs them in a new text editor.
    private async handleGetLogsRequest() {
        await longRunning(`Retrieving logs`, async () => {
            const workspacePods = await filterPodImage(
                this.sessionProvider,
                this.kubectl,
                this.subscriptionId,
                this.resourceGroupName,
                this.clusterName,
                "mcr.microsoft.com/aks/kaito/workspace",
            );
            if (failed(workspacePods)) {
                vscode.window.showErrorMessage(workspacePods.error);
                return;
            }

            if (workspacePods.result.length === 0) {
                vscode.window.showWarningMessage(l10n.t(`No kaito workspace pods found.`));
                return;
            }
            const pod = workspacePods.result[0];
            // retrieves up to 500 lines of logs
            const command = `logs ${pod.podName} -n ${pod.nameSpace} --tail=500`;
            const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(l10n.t(`Error fetching logs: {0}`, kubectlresult.error));
                return;
            }
            const logs = kubectlresult.result.stdout;

            const doc = await vscode.workspace.openTextDocument({
                content: logs,
                language: "plaintext",
            });
            vscode.window.showTextDocument(doc);
        });
    }

    private async handleTestWorkspaceRequest(modelName: string) {
        const args = { target: this.newtarget, modelName: modelName };
        vscode.commands.executeCommand("aks.aksKaitoTest", args);
    }
}
