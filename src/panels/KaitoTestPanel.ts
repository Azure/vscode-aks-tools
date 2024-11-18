import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoTest";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { longRunning } from "../commands/utils/host";

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
        readonly armId: string,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly sessionProvider: ReadyAzureSessionProvider,
        readonly modelName: string,
    ) {
        this.clusterName = clusterName;
        this.subscriptionId = subscriptionId;
        this.resourceGroupName = resourceGroupName;
        this.armId = armId;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
        this.sessionProvider = sessionProvider;
        this.modelName = modelName;
    }
    getTitle(): string {
        return `Test KAITO Model`;
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
    private sendingQuery: boolean = false;

    // Sanitizing the input string
    private escapeSpecialChars(input: string) {
        return input
            .replace(/\\/g, "\\\\") // Escape backslashes
            .replace(/"/g, '\\"') // Escape double quotes
            .replace(/'/g, "") // Remove single quotes
            .replace(/\n/g, "\\n") // Escape newlines
            .replace(/\r/g, "\\r") // Escape carriage returns
            .replace(/\t/g, "\\t") // Escape tabs
            .replace(/\f/g, "\\f") // Escape form feeds
            .replace(/`/g, "") // Remove backticks
            .replace(/\0/g, "\\0"); // Escape null characters
    }

    private async getClusterIP() {
        const ipCommand = `--kubeconfig="${this.kubeConfigFilePath}" get svc workspace-${this.modelName} -o jsonpath='{.spec.clusterIP}' `;
        const ipResult = await this.kubectl.api.invokeCommand(ipCommand);
        if (ipResult && ipResult.code === 0) {
            return ipResult.stdout;
        } else if (ipResult === undefined) {
            vscode.window.showErrorMessage(`Failed to get cluster IP for model ${this.modelName}`);
        } else if (ipResult.code !== 0) {
            vscode.window.showErrorMessage(`Failed to connect to cluster: ${ipResult.code}\nError: ${ipResult.stderr}`);
        }
        return "";
    }
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
        if (this.sendingQuery) {
            vscode.window.showErrorMessage(`A query is currently being sent. Please wait.`);
            return;
        }
        await longRunning(`Sending query...`, async () => {
            // prevents the user from sending another query while the current one is in progress
            this.sendingQuery = true;
            try {
                // retrieving the cluster IP
                const clusterIP = await this.getClusterIP();
                if (clusterIP === "") {
                    this.sendingQuery = false;
                    return;
                }
                const podName = `curl-${Date.now()}`;
                // this command creates a curl pod and executes the query
                const createCommand = `--kubeconfig="${this.kubeConfigFilePath}" run -it --restart=Never ${podName} \
--image=curlimages/curl -- curl -X POST http://${clusterIP}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d '{"prompt":"${this.escapeSpecialChars(prompt)}", \
"generate_kwargs":{"temperature":${temperature}, "top_p":${topP}, "top_k":${topK}, \
"repetition_penalty":${repetitionPenalty}, "max_length":${maxLength}}}'`;
                let curlResult = null;

                // used to delete the curl pod after query is complete
                const deleteCommand = `--kubeconfig="${this.kubeConfigFilePath}" delete pod ${podName}`;
                await this.kubectl.api.invokeCommand(createCommand);

                // retrieve the result of curl request from the pod
                const logsCommand = `--kubeconfig="${this.kubeConfigFilePath}" logs ${podName}`;
                const logsResult = await this.kubectl.api.invokeCommand(logsCommand);
                if (logsResult && logsResult.code === 0) {
                    curlResult = logsResult.stdout;
                    webview.postTestUpdate({
                        clusterName: this.clusterName,
                        modelName: this.modelName,
                        output: JSON.parse(curlResult).Result,
                    });
                } else if (logsResult) {
                    vscode.window.showErrorMessage(
                        `Failed to retrieve logs: ${logsResult.code}\nError: ${logsResult.stderr}`,
                    );
                } else {
                    vscode.window.showErrorMessage(`Failed to connect to cluster`);
                }
                await this.kubectl.api.invokeCommand(deleteCommand);
                this.sendingQuery = false;
                return;
            } catch (error) {
                vscode.window.showErrorMessage(`Error during operation: ${error}`);
                this.sendingQuery = false;
                return;
            }
        });
    }
}
