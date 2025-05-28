import * as vscode from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/headlamp";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { failed } from "../commands/utils/errorable";
import { spawn, ChildProcess } from "child_process";

export class HeadlampPanel extends BasePanel<"headlamp"> {
    constructor(extensionUri: vscode.Uri) {
        super(extensionUri, "headlamp", {
            headlampUpdate: null,
        });
    }
}

export class HeadlampPanelDataProvider implements PanelDataProvider<"headlamp"> {
    public constructor(
        readonly clusterName: string,
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
    ) {
        this.clusterName = clusterName;
        this.kubectl = kubectl;
        this.kubeConfigFilePath = kubeConfigFilePath;
    }
    getTitle(): string {
        return `Deploy Headlamp`;
    }

    getInitialState(): InitialState {
        return {
            deploymentStatus: "undeployed",
            token: "",
        };
    }
    getTelemetryDefinition(): TelemetryDefinition<"headlamp"> {
        return {
            deployHeadlampRequest: true,
            generateTokenRequest: true,
            startPortForwardingRequest: true,
            stopPortForwardingRequest: true,
        };
    }
    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            deployHeadlampRequest: () => {
                this.handleDeployHeadlampRequest(webview);
            },
            generateTokenRequest: () => {
                this.handleGenerateTokenRequest(webview);
            },
            startPortForwardingRequest: () => {
                this.startPortForwarding();
            },
            stopPortForwardingRequest: () => {
                this.stopPortForwarding();
            },
        };
    }

    private portForwardProcess?: ChildProcess;

    private async handleDeployHeadlampRequest(webview: MessageSink<ToWebViewMsgDef>) {
        // deploy headlamp
        const deploy = await invokeKubectlCommand(
            this.kubectl,
            this.kubeConfigFilePath,
            "apply -f https://raw.githubusercontent.com/kinvolk/headlamp/main/kubernetes-headlamp.yaml",
        );
        if (failed(deploy)) {
            vscode.window.showErrorMessage(deploy.error);
            console.log(deploy.error);
            return;
        }

        // wait for headlamp pod to be ready
        webview.postHeadlampUpdate({ deploymentStatus: "deploying", token: "" });
        const wait = await invokeKubectlCommand(
            this.kubectl,
            this.kubeConfigFilePath,
            "wait --namespace kube-system --for=condition=Ready pod -l k8s-app=headlamp --timeout=90s",
        );
        if (failed(wait)) {
            vscode.window.showErrorMessage(wait.error);
            return;
        }

        vscode.window.showInformationMessage("Headlamp deployed successfully!");
        webview.postHeadlampUpdate({ deploymentStatus: "deployed", token: "" });
    }

    private async handleGenerateTokenRequest(webview: MessageSink<ToWebViewMsgDef>) {
        // create service account
        const createServiceAccount = await invokeKubectlCommand(
            this.kubectl,
            this.kubeConfigFilePath,
            "-n kube-system create serviceaccount headlamp-admin",
        );
        if (failed(createServiceAccount)) {
            if (!createServiceAccount.error.includes("already exists")) {
                vscode.window.showErrorMessage(createServiceAccount.error);
                return;
            }
        }

        // create cluster role binding
        const createClusterRoleBinding = await invokeKubectlCommand(
            this.kubectl,
            this.kubeConfigFilePath,
            "create clusterrolebinding headlamp-admin --serviceaccount=kube-system:headlamp-admin --clusterrole=cluster-admin",
        );
        if (failed(createClusterRoleBinding)) {
            if (!createClusterRoleBinding.error.includes("already exists")) {
                vscode.window.showErrorMessage(createClusterRoleBinding.error);
                return;
            }
        }

        // create token
        const createToken = await invokeKubectlCommand(
            this.kubectl,
            this.kubeConfigFilePath,
            "create token headlamp-admin -n kube-system --duration 30m",
        );
        if (failed(createToken)) {
            vscode.window.showErrorMessage(createToken.error);
            return;
        } else {
            const token = createToken.result.stdout.trim();
            console.log(token);
            webview.postHeadlampUpdate({ deploymentStatus: "deployed", token: token });
        }
    }

    private startPortForwarding() {
        if (this.portForwardProcess) {
            vscode.window.showWarningMessage("Port forwarding already running.");
            return;
        }

        this.portForwardProcess = spawn("kubectl", [
            "--kubeconfig",
            this.kubeConfigFilePath,
            "port-forward",
            "-n",
            "kube-system",
            "service/headlamp",
            "8080:80",
        ]);

        this.portForwardProcess.stdout?.on("data", (data) => {
            console.log(`[port-forward] ${data}`);
        });

        this.portForwardProcess.stderr?.on("data", (data) => {
            console.error(`[port-forward error] ${data}`);
        });

        this.portForwardProcess.on("exit", (code) => {
            console.log(`Port forward exited with code ${code}`);
            this.portForwardProcess = undefined;
        });
        vscode.window.showInformationMessage("Port forwarding started.");
        vscode.env.openExternal(vscode.Uri.parse("http://localhost:8080"));
    }

    private stopPortForwarding() {
        if (this.portForwardProcess) {
            this.portForwardProcess.kill();
            this.portForwardProcess = undefined;
            vscode.window.showInformationMessage("Port forwarding stopped.");
        } else {
            vscode.window.showWarningMessage("No port forwarding process running.");
        }
    }
}
