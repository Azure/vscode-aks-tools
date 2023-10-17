import { Uri, window } from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { failed } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { invokeKubectlCommand } from "../commands/utils/kubectl";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/tcpDump";
import { withOptionalTempFile } from "../commands/utils/tempfile";

const nodecapfile = "/tmp/vscodecap.cap";

export class TCPDataCollection extends BasePanel<"tcpDump"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "tcpDump");
    }
}

export class TCPDataCollectionDataProvider implements PanelDataProvider<"tcpDump"> {
    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly clusterName: string,
        readonly linuxNodesList: string[]
    ) { }

    getTitle(): string {
        return `TCP Data Collection ${this.clusterName} for Linux Node`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            allNodes: this.linuxNodesList,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            startDebugPod: args => this._handleStartDebugPod(args.node, webview),
            startTcpDump: args => this._handleStartTcpDump(args.node, webview),
            endTcpDump: args => this._handleEndTcpDump(args.node, webview),
            downloadCaptureFile: args => this._handleDownloadCaptureFile(args.node, args.localcapfile, webview)
        };
    }

    private async _handleStartDebugPod(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const createPodYaml = `
apiVersion: v1
kind: Pod
metadata:
    name: debug-${node}
    namespace: default
spec:
    containers:
    - args: ["-c", "sleep infinity"]
      command: ["/bin/sh"]
      image: docker.io/corfr/tcpdump
      imagePullPolicy: IfNotPresent
      name: debug
      resources: {}
      securityContext:
          privileged: true
          runAsUser: 0
      volumeMounts:
      - mountPath: /host
        name: host-volume
    volumes:
    - name: host-volume
      hostPath:
        path: /
    dnsPolicy: ClusterFirst
    nodeSelector:
      kubernetes.io/hostname: ${node}
    restartPolicy: Never
    securityContext: {}
    hostIPC: true
    hostNetwork: true
    hostPID: true`;

        const applyResult = await withOptionalTempFile(createPodYaml, "YAML", async podSpecFile => {
            const command = `apply -f ${podSpecFile}`;
            return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        });

        if (failed(applyResult)) {
            // TODO: Send command back to webview
            window.showErrorMessage(applyResult.error);
            return;
        }

        // TODO: Send message back to webview to indicate successfully created pod.
        // Also: should we wait until pod is in ready state? Probably
        //webview.postMessage(message: "")
    }

    private async _handleStartTcpDump(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `exec debug-${node} -- /bin/sh -c "tcpdump --snapshot-length=0 -vvv -w ${nodecapfile} 1>/dev/null 2>&1 &"`;
        await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        // TODO: Send message back saying capture has started
    }

    private async _handleEndTcpDump(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `exec debug-${node} -- /bin/sh -c "pkill tcpdump"`;
        await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        // TODO: Send message back saying capture has stopped?
    }

    private async _handleDownloadCaptureFile(node: string, localcapfile: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `cp debug-${node}:${nodecapfile} ${localcapfile}`;
        await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
    }
}
