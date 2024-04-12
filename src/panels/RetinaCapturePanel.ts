import { Uri, commands } from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { InitialState, NodeName, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/retinaCapture";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { withOptionalTempFile } from "../commands/utils/tempfile";
import { KubectlVersion, invokeKubectlCommand } from "../commands/utils/kubectl";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../commands/utils/errorable";
import * as vscode from "vscode";
import { longRunning } from "../commands/utils/host";


export class RetinaCapturePanel extends BasePanel<"retinaCapture"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "retinaCapture", {
            startCaptureResponse: "",
            getAllNodesResponse: [],
        });
    }
}

export class RetinaCaptureProvider implements PanelDataProvider<"retinaCapture"> {
    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly kubectlVersion: KubectlVersion,
        readonly clusterName: string,
        readonly retinaOutput: string,
        readonly allNodeOutput: string[],
        readonly captureFolderName: string
    ) { }

    getTitle(): string {
        return `Retina Distributed Capture on ${this.clusterName}`;
    }

    getTelemetryDefinition(): TelemetryDefinition<"retinaCapture"> {
        return {
            retinaCaptureResult: false, // Add the missing 'clusterName' property with the correct type signature
            getAllNodes: false,
            openFolder: true,
            runRetinaCapture: true,
        }
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            retinaOutput: [this.retinaOutput],
            allNodes: this.allNodeOutput,
            selectedNode: "",
            captureFolderName: this.captureFolderName,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            retinaCaptureResult: (node: string) => this.startCaptureResponse(node, webview),
            getAllNodes: () => this.handleGetAllNodesResponse("", webview),
            openFolder: (args: string) => this.handleOpenFolder(args), // Fix the argument name
            runRetinaCapture: (node: string) => this.handleRunRetinaCapture(node, webview),
        };
    }

    handleGetAllNodesResponse(arg0: string, webview: MessageSink<ToWebViewMsgDef>): void {
        console.log(arg0);
        console.log(webview);
        throw new Error("Method not implemented. 1");
    }

    startCaptureResponse(node: string, webview: MessageSink<ToWebViewMsgDef>): void {
        console.log(node);
        console.log(webview);
        throw new Error("Method not implemented. 2");
    }

    private handleOpenFolder(path: string) {
        commands.executeCommand("revealFileInOS", Uri.file(path));
    }

    private async handleRunRetinaCapture(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        console.log(webview);
        const createPodYaml = `
apiVersion: v1
kind: Pod
metadata:
  name: node-explorer-${node}
spec:
  nodeName: ${node}
  volumes:
  - name: mnt-captures
    hostPath:
      path: /mnt/capture
  containers:
  - name: node-explorer
    image: alpine
    command: ["sleep", "9999999999"]
    volumeMounts:
    - name: mnt-captures
      mountPath: /mnt/capture
`;

        vscode.window.showInformationMessage(`Lets start the pod to capture to local.`);

        const applyResult = await longRunning(`Deploying pod to capture ${node} retina data.`, async () => {
            return await withOptionalTempFile(createPodYaml, "YAML", async (podSpecFile) => {
                const command = `apply -f ${podSpecFile}`;
                return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
            });
        });

        if (failed(applyResult)) {
            vscode.window.showErrorMessage(`Failed to apply Pod: ${applyResult.error}`);
            throw new Error(`Failed to apply Pod: ${applyResult.error}`);
        }
        const waitResult = await longRunning(`waiting for pod to get ready node-explorer-${node}.`, async () => {
            const command = `wait pod -n default --for=condition=ready --timeout=300s node-explorer-${node}`;
            return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        });

        if (failed(waitResult)) {
            vscode.window.showErrorMessage(`Failed to wait for Pod to be ready: ${waitResult.error}`);
            return;
        }


        // // kubectl cp 
        const nodeExplorerResult = await longRunning(`Copy captured data to local host location ${this.captureFolderName}.`, async () => {
            const cpcommand = `cp node-explorer-${node}:mnt/capture ${this.captureFolderName} --request-timeout=10m`;
            return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, cpcommand);
        });

        if (failed(nodeExplorerResult)) {
            vscode.window.showErrorMessage(`Failed to apply copy command: ${nodeExplorerResult.error}`);
            return;
        }

        vscode.window.showInformationMessage(`Successfully copied the Retina Capture data to ${this.captureFolderName}`);

    }
}