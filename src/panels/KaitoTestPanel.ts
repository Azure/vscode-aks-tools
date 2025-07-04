import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import { longRunning } from "../commands/utils/host";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoTest";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import {
    createCurlPodCommand,
    deleteCurlPodCommand,
    getClusterIP,
    getCurlPodLogsCommand,
    getWorkspaceRuntime,
} from "./utilities/KaitoHelpers";
import { l10n } from "vscode";

export class KaitoTestPanel extends BasePanel<"kaitoTest"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "kaitoTest", {
            testUpdate: null,
        });
    }
}

export class KaitoTestPanelDataProvider implements PanelDataProvider<"kaitoTest"> {
    public constructor(
        readonly clusterName: string,
        readonly subscriptionId: string,
        readonly resourceGroupName: string,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly modelName: string,
        readonly namespace: string,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
        this.sessionProvider = sessionProvider;
        // corrects for some version naming
        this.modelName = modelName;
        this.namespace = namespace;
    }
    getTitle(): string {
        return l10n.t(`Test KAITO Model`);
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            modelName: this.modelName,
            output: "",
        };
    }
    getTelemetryDefinition(): TelemetryDefinition<"kaitoTest"> {
        return {
            queryRequest: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            queryRequest: (params) => {
                this.handleQueryRequest(
                    params.prompt,
                    params.temperature,
                    params.topP,
                    params.topK,
                    params.repetitionPenalty,
                    params.maxLength,
                    webview,
                );
            },
        };
    }

    nullIsFalse(value: boolean | null): boolean {
        return value ?? false;
    }
    // Tracks if query is currently beign sent. If so, prevents user from sending another query
    private isQueryInProgress: boolean = false;
    // Sends a request to the inference server to generate a response to the given prompt
    private async handleQueryRequest(
        prompt: string,
        temperature: number,
        topP: number,
        topK: number,
        repetitionPenalty: number,
        maxLength: number,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (this.isQueryInProgress) {
            vscode.window.showErrorMessage(l10n.t(`A query is currently being sent. Please wait.`));
            return;
        }
        await longRunning(`Sending query...`, async () => {
            // prevents the user from sending another query while the current one is in progress
            this.isQueryInProgress = true;
            const podName = `curl-${Date.now()}`;
            try {
                // retrieving the cluster IP
                const clusterIP = await getClusterIP(
                    this.kubeConfigFilePath,
                    this.modelName,
                    this.kubectl,
                    this.namespace,
                );
                if (clusterIP === "") {
                    this.isQueryInProgress = false;
                    vscode.window.showErrorMessage(
                        l10n.t(`Error connecting to cluster. Please check pod logs and try again`),
                    );
                    return;
                }
                const runtime = await getWorkspaceRuntime(
                    this.kubeConfigFilePath,
                    this.modelName,
                    this.kubectl,
                    this.namespace,
                );
                // this command creates a curl pod and executes the query
                const createCommand = await createCurlPodCommand(
                    this.kubeConfigFilePath,
                    podName,
                    this.modelName,
                    clusterIP,
                    prompt,
                    temperature,
                    topP,
                    topK,
                    repetitionPenalty,
                    maxLength,
                    runtime,
                );
                console.log(createCommand);
                // used to delete the curl pod after query is complete
                const deleteCommand = deleteCurlPodCommand(this.kubeConfigFilePath, podName);

                // retrieve the result of curl request from the pod
                const logsCommand = getCurlPodLogsCommand(this.kubeConfigFilePath, podName);

                // create the curl pod
                await this.kubectl.api.invokeCommand(createCommand);

                // retrieve the logs from the curl pod
                const logsResult = await this.kubectl.api.invokeCommand(logsCommand);
                if (logsResult && logsResult.code === 0) {
                    const parsedOutput = JSON.parse(logsResult.stdout);
                    let responseText;
                    if (runtime === "transformers") {
                        responseText = parsedOutput.Result;
                    } else {
                        responseText = (parsedOutput.choices?.[0]?.text || "").trim();
                    }
                    webview.postTestUpdate({
                        clusterName: this.clusterName,
                        modelName: this.modelName,
                        output: responseText,
                    });
                } else if (logsResult) {
                    vscode.window.showErrorMessage(
                        `Failed to retrieve logs: ${logsResult.code}\nError: ${logsResult.stderr}`,
                    );
                } else {
                    vscode.window.showErrorMessage(l10n.t(`Failed to connect to cluster`));
                }
                await this.kubectl.api.invokeCommand(deleteCommand);
                this.isQueryInProgress = false;
                return;
            } catch (error) {
                // deletes pod if an error occurs during log retrieval
                const failsafeDeletion = deleteCurlPodCommand(this.kubeConfigFilePath, podName);
                await this.kubectl.api.invokeCommand(failsafeDeletion);

                // display error & reset query status
                vscode.window.showErrorMessage(`Error during operation: ${error}`);
                this.isQueryInProgress = false;
                return;
            }
        });
    }
}
