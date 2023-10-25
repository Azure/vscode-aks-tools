import { platform } from "os";
import { relative } from "path";
import { Uri, window } from "vscode";
import * as k8s from 'vscode-kubernetes-tools-api';
import { failed, map as errmap, Errorable } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { getExecOutput, invokeKubectlCommand } from "../commands/utils/kubectl";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../webview-contract/webviewDefinitions/tcpDump";
import { withOptionalTempFile } from "../commands/utils/tempfile";

const debugPodNamespace = "default";
const tcpDumpArgs = "--snapshot-length=0 -vvv";
const captureDir = "/tmp";
const captureFilePrefix = "vscodenodecap_";
const captureFileBasePath = `${captureDir}/${captureFilePrefix}`;
const captureFilePathRegex = `${captureFileBasePath.replace(/\//g, '\\$&')}(.*)\.cap`;

function getPodName(node: string) {
    return `debug-${node}`;
}

function getTcpDumpCommand(capture: string): string {
    return `tcpdump ${tcpDumpArgs} -w ${captureFileBasePath}${capture}.cap`;
}

function getCaptureFromCommand(command: string, args: string): string | null {
    if (command !== "tcpdump") return null;
    if (!args.startsWith(tcpDumpArgs)) return null;
    const fileMatch = args.match(new RegExp(`\-w ${captureFilePathRegex}`));
    return fileMatch && fileMatch[1];
}

function getCaptureFromFilePath(filePath: string): string | null {
    const fileMatch = filePath.match(new RegExp(captureFilePathRegex));
    if (!fileMatch) return null;
    return fileMatch && fileMatch[1];
}

export class TCPDataCollection extends BasePanel<"tcpDump"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "tcpDump", {
            checkNodeStateResponse: null,
            startDebugPodResponse: null,
            deleteDebugPodResponse: null,
            startCaptureResponse: null,
            stopCaptureResponse: null,
            downloadCaptureFileResponse: null
        });
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
            checkNodeState: args => this._handleCheckNodeState(args.node, webview),
            startDebugPod: args => this._handleStartDebugPod(args.node, webview),
            deleteDebugPod: args => this._handleDeleteDebugPod(args.node, webview),
            startCapture: args => this._handleStartCapture(args.node, args.capture, webview),
            stopCapture: args => this._handleStopCapture(args.node, args.capture, webview),
            downloadCaptureFile: args => this._handleDownloadCaptureFile(args.node, args.capture, webview)
        };
    }

    private async _handleCheckNodeState(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const podNames = await this._getPodNames();
        if (failed(podNames)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to get debug pod names:\n${podNames.error}`,
                isDebugPodRunning: false,
                runningCapture: null,
                completedCaptures: []
            });
            return;
        }

        const isDebugPodRunning = podNames.result.includes(getPodName(node));
        if (!isDebugPodRunning) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: true,
                errorMessage: null,
                isDebugPodRunning,
                runningCapture: null,
                completedCaptures: []
            });
            return;
        }

        const waitResult = await this._waitForPodReady(node);
        if (failed(waitResult)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Pod ${getPodName(node)} is not ready:\n${waitResult.error}`,
                isDebugPodRunning,
                runningCapture: null,
                completedCaptures: []
            });
            return;
        }

        const runningCaptureProcs = await this._getRunningCaptures(node);
        if (failed(runningCaptureProcs)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to read running captures:\n${runningCaptureProcs.error}`,
                isDebugPodRunning,
                runningCapture: null,
                completedCaptures: []
            });
            return;
        }

        const runningCapture = runningCaptureProcs.result.length > 0 ? runningCaptureProcs.result[0].capture : null;
        const completedCaptures = await this._getCompletedCaptures(node, runningCaptureProcs.result.map(p => p.capture));
        if (failed(completedCaptures)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to read completed captures:\n${completedCaptures.error}`,
                isDebugPodRunning,
                runningCapture,
                completedCaptures: []
            });
            return;
        }

        webview.postCheckNodeStateResponse({
            node,
            succeeded: true,
            errorMessage: null,
            isDebugPodRunning,
            runningCapture,
            completedCaptures: completedCaptures.result
        });
    }

    private async _handleStartDebugPod(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const createPodYaml = `
apiVersion: v1
kind: Pod
metadata:
    name: ${getPodName(node)}
    namespace: ${debugPodNamespace}
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
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Unable to create debug pod:\n${applyResult.error}`
            });
            return;
        }

        const waitResult = await this._waitForPodReady(node);
        if (failed(waitResult)) {
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Pod ${getPodName(node)} is not ready:\n${waitResult.error}`
            });
            return;
        }

        webview.postStartDebugPodResponse({
            node,
            succeeded: true,
            errorMessage: null
        });
    }

    private async _handleDeleteDebugPod(node: string, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `delete pod -n ${debugPodNamespace} ${getPodName(node)}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        webview.postDeleteDebugPodResponse({
            node,
            succeeded: output.succeeded,
            errorMessage: failed(output) ? output.error : null
        });
    }

    private async _handleStartCapture(node: string, capture: string, webview: MessageSink<ToWebViewMsgDef>) {
        const podCommand = `/bin/sh -c "${getTcpDumpCommand(capture)} 1>/dev/null 2>&1 &"`;
        const output = await getExecOutput(this.kubectl, this.kubeConfigFilePath, debugPodNamespace, getPodName(node), podCommand);
        webview.postStartCaptureResponse({
            node,
            succeeded: output.succeeded,
            errorMessage: failed(output) ? output.error : null
        });
    }

    private async _handleStopCapture(node: string, capture: string, webview: MessageSink<ToWebViewMsgDef>) {
        const runningCaptures = await this._getRunningCaptures(node);
        if (failed(runningCaptures)) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to determine running captures:\n${runningCaptures.error}`
            });
            return;
        }

        const captureProcess = runningCaptures.result.find(p => p.capture === capture);
        if (!captureProcess) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Unable to find running capture ${capture}. Found: ${runningCaptures.result.map(p => p.capture).join(",")}`
            });
            return;
        }

        const podCommand = `/bin/sh -c "kill ${captureProcess.pid}"`;
        const output = await getExecOutput(this.kubectl, this.kubeConfigFilePath, debugPodNamespace, getPodName(node), podCommand);
        webview.postStopCaptureResponse({
            node,
            succeeded: output.succeeded,
            errorMessage: failed(output) ? output.error : null
        });
    }

    private async _handleDownloadCaptureFile(node: string, captureName: string, webview: MessageSink<ToWebViewMsgDef>) {
        const localCaptureUri = await window.showSaveDialog({
            defaultUri: Uri.file(`${captureName}.cap`),
            filters: {"Capture Files": ['cap']},
            saveLabel: 'Download',
            title: 'Download Capture File'
        });

        if (!localCaptureUri) {
            return;
        }

        const localCpPath = getLocalKubectlCpPath(localCaptureUri);
        const command = `cp -n ${debugPodNamespace} ${getPodName(node)}:${captureFileBasePath}${captureName}.cap ${localCpPath}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(output)) {
            webview.postDownloadCaptureFileResponse({
                node,
                captureName,
                localCapturePath: localCaptureUri.fsPath,
                succeeded: false,
                errorMessage: `Failed to download ${captureName} to ${localCaptureUri.fsPath}:\n${output.error}`
            });
            return;
        }

        webview.postDownloadCaptureFileResponse({
            node,
            captureName,
            localCapturePath: localCaptureUri.fsPath,
            succeeded: output.succeeded,
            errorMessage: null
        });
    }

    private async _getPodNames(): Promise<Errorable<string[]>> {
        const command = `get pod -n ${debugPodNamespace} --no-headers -o custom-columns=":metadata.name"`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        return errmap(output, sr => sr.stdout.trim().split("\n"));
    }

    private async _waitForPodReady(node: string): Promise<Errorable<void>> {
        const waitCommand = `wait pod -n ${debugPodNamespace} --for=condition=ready --timeout=300s ${getPodName(node)}`;
        const waitOutput = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, waitCommand);
        return errmap(waitOutput, _ => undefined);
    }

    private async _getRunningCaptures(node: string): Promise<Errorable<TcpDumpProcess[]>> {
        const podCommand = "ps -eo pid,comm,args";
        const output = await getExecOutput(this.kubectl, this.kubeConfigFilePath, debugPodNamespace, getPodName(node), podCommand);
        return errmap(output, sr => sr.stdout.trim().split("\n").map(asProcess).filter(isTcpDump));

        function asProcess(psOutputLine: string): Process {
            const parts = psOutputLine.trim().split(/\s+/);
            const pid = parseInt(parts[0]);
            const command = parts[1];
            const args = parts.slice(2).join(' ');
            const capture = getCaptureFromCommand(command, args);
            const isTcpDump = capture !== null;
            const process = {pid, command, args, isTcpDump, capture};
            return process;
        }
    }

    private async _getCompletedCaptures(node: string, runningCaptures: string[]): Promise<Errorable<string[]>> {
        // Use 'find' rather than 'ls' (http://mywiki.wooledge.org/ParsingLs)
        const podCommand = `find ${captureDir} -type f -name ${captureFilePrefix}*.cap`;
        const output = await getExecOutput(this.kubectl, this.kubeConfigFilePath, debugPodNamespace, getPodName(node), podCommand);
        return errmap(output, sr => sr.stdout.trim().split("\n").map(getCaptureFromFilePath).filter(c => c !== null && !runningCaptures.includes(c)) as string[]);
    }
}

type Process = {
    pid: number,
    command: string,
    args: string,
    isTcpDump: boolean
};

type TcpDumpProcess = Process & {
    isTcpDump: true,
    capture: string
};

function isTcpDump(process: Process): process is TcpDumpProcess {
    return process.isTcpDump;
}

function getLocalKubectlCpPath(fileUri: Uri): string {
    if (platform().toLowerCase() !== "win32") {
        return fileUri.fsPath;
    }

    // TODO: Investigate why the working directory seems to be something other than `process.cwd()`
    //       when running `kubectl cp`.

    // Use a relative path to work around Windows path issues:
    // - https://github.com/kubernetes/kubernetes/issues/77310
    // - https://github.com/kubernetes/kubernetes/issues/110120
    return relative(process.cwd(), fileUri.fsPath);
}