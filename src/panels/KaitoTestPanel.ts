import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { ReadyAzureSessionProvider } from "../auth/types";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/kaitoTest";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { failed } from "../commands/utils/errorable";
import { exec, ExecException, spawn } from "child_process";
import { longRunning } from "../commands/utils/host";
import getPort from "get-port";

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
            queryRequest: false,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        void webview;
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
    private sendingQuery: boolean = false;

    private escapeSpecialChars(input: string) {
        return input
            .replace(/\\/g, "\\\\") // Escape backslashes
            .replace(/"/g, '\\"') // Escape double quotes
            .replace(/'/g, "") // Escape single quotes
            .replace(/\n/g, "\\n") // Escape newlines
            .replace(/\r/g, "\\r") // Escape carriage returns
            .replace(/\t/g, "\\t") // Escape tabs
            .replace(/\f/g, "\\f") // Escape form feeds
            .replace(/`/g, "") // Remove backticks
            .replace(/\0/g, "\\0"); // Escape null characters
    }

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
            return;
        }
        await longRunning(`Sending query...`, async () => {
            this.sendingQuery = true;
            const command = `get svc workspace-${this.modelName} -o jsonpath="{.spec.clusterIPs[0]}"`;
            const kubectlresult = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            if (failed(kubectlresult)) {
                vscode.window.showErrorMessage(`Error fetching logs: ${kubectlresult.error}`);
                this.sendingQuery = false;
                return;
            }
            void prompt;
            void temperature;
            void topP;
            void topK;
            void repetitionPenalty;
            void maxLength;
            void webview;

            const localPort = await getPort();
            const portForwardProcess = spawn("kubectl", [
                "port-forward",
                `svc/workspace-${this.modelName}`,
                `${localPort}:80`,
                "--kubeconfig",
                this.kubeConfigFilePath,
            ]);

            await new Promise((resolve) => setTimeout(resolve, 2000));

            const curlCommand = `curl -X POST http://localhost:${localPort}/chat -H "accept: application/json" -H \
"Content-Type: application/json" -d '{"prompt":"${this.escapeSpecialChars(prompt)}", "generate_kwargs":{"temperature":${temperature}, "top_p":${topP}, "top_k":${topK}, "max_length":${maxLength}}}' | jq '.Result'`;
            await new Promise<void>((resolve, reject) => {
                exec(curlCommand, (error: ExecException | null, stdout: string, stderr: string) => {
                    if (error) {
                        vscode.window.showErrorMessage(`Error executing curl command: ${stderr}`);
                        reject(error);
                        this.sendingQuery = false;
                    } else {
                        webview.postTestUpdate({
                            clusterName: this.clusterName,
                            modelName: this.modelName,
                            output: stdout
                                .slice(1, -2)
                                .replace(/\\n/g, "\n")
                                .replace(/\\\\/g, "\\")
                                .replace(/\\"/g, '"'),
                        });
                        resolve();
                    }
                    portForwardProcess.kill();
                });
            });
        });
        this.sendingQuery = false;
    }
}
