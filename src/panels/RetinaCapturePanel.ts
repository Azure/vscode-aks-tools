import open from 'open';
import { platform } from "os";
import { relative } from "path";
import * as vscode from "vscode";
import { Uri, window, workspace } from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { withOptionalTempFile } from "../commands/utils/tempfile";
import { MessageHandler } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef } from "../webview-contract/webviewDefinitions/retinaCapture";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";


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
            handleCaptureFileDownload: true,
            deleteRetinaNodeExplorer: true,
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

    getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {
            handleCaptureFileDownload: (node: string) => this.handleCaptureFileDownload(node),
            deleteRetinaNodeExplorer: (node: string) => { this. handleDeleteRetinaNodeExplorer(node) }
        };
    }

    private async handleDeleteRetinaNodeExplorer(node: string) {
    }

    private async handleCaptureFileDownload(node: string) {
        const localCaptureUri = await window.showSaveDialog({
            defaultUri: Uri.file(this.captureFolderName),
            saveLabel: "Download",
            title: "Download Retina File",
        });

        if (!localCaptureUri) {
            return;
        }

        const localCpPath = getLocalKubectlCpPath(localCaptureUri);

        const createPodYaml = `
apiVersion: v1
kind: Pod
metadata:
  name: node-explorer-${node}
spec:
  nodeName: ${node}
  tolerations:
    - key: CriticalAddonsOnly
      operator: Exists
    - effect: NoExecute
      operator: Exists
    - effect: NoSchedule
      operator: Exists
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
`  ;

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
        const nodeExplorerResult = await longRunning(`Copy captured data to local host location ${localCpPath}.`, async () => {
            const cpcommand = `cp node-explorer-${node}:mnt/capture ${localCpPath} --retries 99`;
            return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, cpcommand);
        });

        if (failed(nodeExplorerResult)) {
            vscode.window.showErrorMessage(`Failed to apply copy command: ${nodeExplorerResult.error}`);
            return;
        }

        const goToFolder = "Go to Folder";
        vscode.window.showInformationMessage(`Successfully copied the Retina Capture data to ${localCpPath}`, goToFolder)
            .then(selection => {
                if (selection === goToFolder) {
                    open(localCpPath);
                    // vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(`${localCpPath}`));
                }
            });
    }
}

function getLocalKubectlCpPath(fileUri: Uri): string {
    if (platform().toLowerCase() !== "win32") {
        return fileUri.fsPath;
    }

    // Use a relative path to work around Windows path issues:
    // - https://github.com/kubernetes/kubernetes/issues/77310
    // - https://github.com/kubernetes/kubernetes/issues/110120
    // To use a relative path we need to know the current working directory.
    // This should be `process.cwd()` but it actually seems to be that of the first workspace folder, if any exist.
    // TODO: Investigate why, and look at alternative ways of getting the working directory, or working around
    //       the need to to this altogether by allowing absolute paths.
    const workingDirectory =
        workspace.workspaceFolders && workspace.workspaceFolders?.length > 0
            ? workspace.workspaceFolders[0].uri.fsPath
            : process.cwd();

    return relative(workingDirectory, fileUri.fsPath);
}