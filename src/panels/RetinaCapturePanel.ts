import * as vscode from "vscode";
import * as path from "path";
import { Uri, window } from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import { failed } from "../commands/utils/errorable";
import { longRunning } from "../commands/utils/host";
import { KubectlVersion, invokeKubectlCommand } from "../commands/utils/kubectl";
import { withOptionalTempFile } from "../commands/utils/tempfile";
import { MessageHandler } from "../webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef } from "../webview-contract/webviewDefinitions/retinaCapture";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { getLocalKubectlCpPath } from "./utilities/KubectlNetworkHelper";
import * as semver from "semver";
import { l10n, commands, env } from "vscode";

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
        readonly retinaOutput: string,
        readonly clusterName: string,
        readonly isDownloadRetinaCapture: boolean,
        readonly kubectl?: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubectlVersion?: KubectlVersion,
        readonly kubeConfigFilePath: string = "",
        readonly allNodeOutput: string[] = [],
        readonly captureFolderName: string = "",
        readonly isNodeExplorerPodExists: boolean = false,
    ) {}

    getTitle(): string {
        return l10n.t(`Retina Distributed Capture on {0}`, this.clusterName);
    }

    getTelemetryDefinition(): TelemetryDefinition<"retinaCapture"> {
        return {
            handleCaptureFileDownload: true,
            deleteRetinaNodeExplorer: true,
        };
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            retinaOutput: [this.retinaOutput],
            allNodes: this.allNodeOutput,
            selectedNode: "",
            captureFolderName: this.captureFolderName,
            isNodeExplorerPodExists: this.isNodeExplorerPodExists,
            isDownloadRetinaCapture: this.isDownloadRetinaCapture,
        };
    }

    getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {
            handleCaptureFileDownload: (node: string) => this.handleCaptureFileDownload(node),
            deleteRetinaNodeExplorer: (node: string) => {
                this.handleDeleteRetinaNodeExplorer(node);
            },
        };
    }

    private async handleDeleteRetinaNodeExplorer(node: string) {
        // node is a comma separated string of node names
        // ex: "aks-nodepool1-12345678-vmss000000,aks-nodepool1-12345678-vmss000001"
        const nodes = node.split(",");
        for (const node of nodes) {
            await this.deleteNodeExplorerUsingKubectl(node);
        }
    }

    private async deleteNodeExplorerUsingKubectl(node: string) {
        if (!this.kubectl) {
            vscode.window.showErrorMessage(l10n.t("Kubectl is not available"));
            return;
        }

        const deleteResult = await longRunning(`${l10n.t("Deleting pod")} node-explorer-${node}.`, async () => {
            const command = `delete pod node-explorer-${node}`;
            return await invokeKubectlCommand(this.kubectl!, this.kubeConfigFilePath, command);
        });

        if (failed(deleteResult)) {
            vscode.window.showErrorMessage(l10n.t(`Failed to delete Pod: {0}`, deleteResult.error));
            return;
        }
    }

    private async handleCaptureFileDownload(node: string) {
        const localCaptureUri = await window.showSaveDialog({
            defaultUri: Uri.file(this.captureFolderName),
            saveLabel: l10n.t("Download"),
            title: l10n.t("Download Retina File"),
        });

        if (!localCaptureUri) {
            return;
        }

        const localCpPath = getLocalKubectlCpPath(localCaptureUri);

        const nodes = node.split(",");
        for (const node of nodes) {
            await this.copyRetinaCaptureData(node, localCpPath);
        }
    }

    async copyRetinaCaptureData(node: string, localCpPath: string) {
        if (!this.kubectl || !this.kubectlVersion) {
            vscode.window.showErrorMessage(l10n.t("Kubectl is not available"));
            return;
        }

        const createPodYaml = `
apiVersion: v1
kind: Pod
metadata:
  name: node-explorer-${node}
  labels:
    app: node-explorer
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
`;

        const applyResult = await longRunning(l10n.t(`Deploying pod to capture {0} retina data.`, node), async () => {
            return await withOptionalTempFile(createPodYaml, "YAML", async (podSpecFile) => {
                const command = `apply -f ${podSpecFile}`;
                return await invokeKubectlCommand(this.kubectl!, this.kubeConfigFilePath, command);
            });
        });

        if (failed(applyResult)) {
            vscode.window.showErrorMessage(`Failed to apply Pod: ${applyResult.error}`);
            return;
        }
        const waitResult = await longRunning(
            `${l10n.t("waiting for pod to get ready")} node-explorer-${node}.`,
            async () => {
                const command = `wait pod -n default --for=condition=ready --timeout=300s node-explorer-${node}`;
                return await invokeKubectlCommand(this.kubectl!, this.kubeConfigFilePath, command);
            },
        );

        if (failed(waitResult)) {
            vscode.window.showErrorMessage(l10n.t(`Failed to wait for Pod to be ready: {0}`, waitResult.error));
            return;
        }

        /* kubectl cp functionality is used to copy the data from the pod to the local host.
           `kubectl cp` can fail with an EOF error for large files, and there's currently no good workaround:
           See: https://github.com/kubernetes/kubernetes/issues/60140
           The best advice I can see is to use the 'retries' option if it is supported, and the
           'request-timeout' option otherwise. */
        const clientVersion = this.kubectlVersion!.clientVersion.gitVersion.replace(/^v/, "");
        const isRetriesOptionSupported = semver.parse(clientVersion) && semver.gte(clientVersion, "1.23.0");
        const cpEOFAvoidanceFlag = isRetriesOptionSupported ? "--retries 99" : "--request-timeout=10m";
        const captureHostFolderName = `${localCpPath}-${node}`;
        const nodeExplorerResult = await longRunning(
            l10n.t(`Copy captured data to local host location {0}.`, captureHostFolderName),
            async () => {
                const cpcommand = `cp node-explorer-${node}:mnt/capture ${captureHostFolderName} ${cpEOFAvoidanceFlag}`;
                return await invokeKubectlCommand(this.kubectl!, this.kubeConfigFilePath, cpcommand);
            },
        );

        if (failed(nodeExplorerResult)) {
            vscode.window.showErrorMessage(l10n.t(`Failed to apply copy command: {0}`, nodeExplorerResult.error));
            return;
        }

        const goToFolder = "Go to Folder";
        vscode.window
            .showInformationMessage(
                l10n.t(`Successfully copied the Retina Capture data to {0}).`, captureHostFolderName),
                goToFolder,
            )
            .then((selection) => {
                if (selection === goToFolder) {
                    // acquiring absolute path for the file system
                    const abs = path.resolve(captureHostFolderName);
                    if (env.remoteName === "wsl") {
                        commands.executeCommand("remote-wsl.revealInExplorer", Uri.file(abs));
                    } else {
                        commands.executeCommand("revealFileInOS", Uri.file(abs));
                    }
                }
            });
    }
}
