import { platform } from "os";
import { relative } from "path";
import { Uri, commands, window, workspace } from "vscode";
import * as k8s from "vscode-kubernetes-tools-api";
import * as semver from "semver";
import { failed, map as errmap, Errorable } from "../commands/utils/errorable";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { KubectlVersion, getExecOutput, invokeKubectlCommand } from "../commands/utils/kubectl";
import {
    CaptureFilters,
    CompletedCapture,
    FilterPod,
    InitialState,
    NodeName,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/tcpDump";
import { withOptionalTempFile } from "../commands/utils/tempfile";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

const debugPodNamespace = "default";
const tcpDumpCommandBase = "tcpdump --snapshot-length=0 -vvv";
const captureDir = "/tmp";
const captureFilePrefix = "vscodenodecap_";
const captureFileBasePath = `${captureDir}/${captureFilePrefix}`;
const captureFileBasePathEscaped = escapeRegExp(captureFileBasePath);
const captureFilePathRegex = `${captureFileBasePathEscaped}(.*)\\.cap`; // Matches the part of the filename after the prefix

// Escape all regex meta characters to ensure sanitation and '/' for later use in regex pattern
export function escapeRegExp(input: string): string {
    return input.replace(/(\\)?([.*+?^${}()|[\]\\/])/g, (match, backslash, char) => {
        // If there's a backslash before the character, return the match unchanged. (To prevent double escaping)
        return backslash ? match : `\\${char}`;
    });
} //Reference for regex syntax chars: https://262.ecma-international.org/13.0/index.html#prod-SyntaxCharacter

function getPodName(node: NodeName) {
    return `debug-${node}`;
}

function getTcpDumpCommand(capture: string, filters: CaptureFilters): string {
    const parts = [
        tcpDumpCommandBase,
        filters.interface ? `-i ${filters.interface}` : "",
        `-w ${captureFileBasePath}${capture}.cap`,
        filters.pcapFilterString || "",
    ].filter((part) => !!part);
    return parts.join(" ");
}

function getCaptureFromCommand(command: string, commandWithArgs: string): string | null {
    if (command !== "tcpdump") return null;
    if (!commandWithArgs.startsWith(tcpDumpCommandBase)) return null;
    const fileMatch = commandWithArgs.match(new RegExp(`\\-w ${captureFilePathRegex}`));
    return fileMatch && fileMatch[1];
}

function getCaptureFromFilePath(filePath: string): string | null {
    const fileMatch = filePath.match(new RegExp(captureFilePathRegex));
    if (!fileMatch) return null;
    return fileMatch && fileMatch[1];
}

export class TcpDumpPanel extends BasePanel<"tcpDump"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "tcpDump", {
            checkNodeStateResponse: null,
            startDebugPodResponse: null,
            deleteDebugPodResponse: null,
            startCaptureResponse: null,
            stopCaptureResponse: null,
            downloadCaptureFileResponse: null,
            getInterfacesResponse: null,
            getAllNodesResponse: null,
            getFilterPodsForNodeResponse: null,
        });
    }
}

export class TcpDumpDataProvider implements PanelDataProvider<"tcpDump"> {
    constructor(
        readonly kubectl: k8s.APIAvailable<k8s.KubectlV1>,
        readonly kubeConfigFilePath: string,
        readonly kubectlVersion: KubectlVersion,
        readonly clusterName: string,
        readonly linuxNodesList: string[],
    ) {}

    getTitle(): string {
        return `TCP Capture on ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            clusterName: this.clusterName,
            allNodes: this.linuxNodesList,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"tcpDump"> {
        return {
            checkNodeState: false,
            startDebugPod: true,
            deleteDebugPod: true,
            startCapture: true,
            stopCapture: true,
            downloadCaptureFile: true,
            openFolder: true,
            getInterfaces: false,
            getAllNodes: false,
            getFilterPodsForNode: false,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            checkNodeState: (args) => this.handleCheckNodeState(args.node, webview),
            startDebugPod: (args) => this.handleStartDebugPod(args.node, webview),
            deleteDebugPod: (args) => this.handleDeleteDebugPod(args.node, webview),
            startCapture: (args) => this.handleStartCapture(args.node, args.capture, args.filters, webview),
            stopCapture: (args) => this.handleStopCapture(args.node, args.capture, webview),
            downloadCaptureFile: (args) => this.handleDownloadCaptureFile(args.node, args.capture, webview),
            openFolder: (args) => this.handleOpenFolder(args),
            getInterfaces: (args) => this.handleGetInterfaces(args.node, webview),
            getAllNodes: () => this.handleGetAllNodes(webview),
            getFilterPodsForNode: (args) => this.handleGetFilterPodsForNode(args.node, webview),
        };
    }

    private async handleCheckNodeState(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        const podNames = await this.getPodNames();
        if (failed(podNames)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to get debug pod names:\n${podNames.error}`,
                isDebugPodRunning: false,
                runningCapture: null,
                completedCaptures: [],
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
                completedCaptures: [],
            });
            return;
        }

        const waitResult = await this.waitForPodReady(node);
        if (failed(waitResult)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Pod ${getPodName(node)} is not ready:\n${waitResult.error}`,
                isDebugPodRunning,
                runningCapture: null,
                completedCaptures: [],
            });
            return;
        }

        const runningCaptureProcs = await this.getRunningCaptures(node);
        if (failed(runningCaptureProcs)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to read running captures:\n${runningCaptureProcs.error}`,
                isDebugPodRunning,
                runningCapture: null,
                completedCaptures: [],
            });
            return;
        }

        const runningCapture = runningCaptureProcs.result.length > 0 ? runningCaptureProcs.result[0].capture : null;
        const completedCaptures = await this.getCompletedCaptures(
            node,
            runningCaptureProcs.result.map((p) => p.capture),
        );
        if (failed(completedCaptures)) {
            webview.postCheckNodeStateResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to read completed captures:\n${completedCaptures.error}`,
                isDebugPodRunning,
                runningCapture,
                completedCaptures: [],
            });
            return;
        }

        webview.postCheckNodeStateResponse({
            node,
            succeeded: true,
            errorMessage: null,
            isDebugPodRunning,
            runningCapture,
            completedCaptures: completedCaptures.result,
        });
    }

    private async handleStartDebugPod(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
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
      image: mcr.microsoft.com/dotnet/runtime-deps:6.0
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

        const applyResult = await withOptionalTempFile(createPodYaml, "YAML", async (podSpecFile) => {
            const command = `apply -f ${podSpecFile}`;
            return await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        });

        if (failed(applyResult)) {
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Unable to create debug pod:\n${applyResult.error}`,
            });
            return;
        }

        const waitResult = await this.waitForPodReady(node);
        if (failed(waitResult)) {
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Pod ${getPodName(node)} is not ready:\n${waitResult.error}`,
            });
            return;
        }

        const installResult = await this.installDebugTools(node);
        if (failed(installResult)) {
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Installing debug tools failed on ${getPodName(node)}:\n${installResult.error}`,
            });
            return;
        }

        webview.postStartDebugPodResponse({
            node,
            succeeded: true,
            errorMessage: null,
        });
    }

    private async handleDeleteDebugPod(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        const command = `delete pod -n ${debugPodNamespace} ${getPodName(node)}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(output)) {
            webview.postDeleteDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to delete ${getPodName(node)}:\n${output.error}`,
            });
            return;
        }

        const waitResult = await this.waitForPodDeleted(node);
        if (failed(waitResult)) {
            webview.postStartDebugPodResponse({
                node,
                succeeded: false,
                errorMessage: `Pod ${getPodName(node)} was not deleted:\n${waitResult.error}`,
            });
            return;
        }

        webview.postDeleteDebugPodResponse({
            node,
            succeeded: true,
            errorMessage: null,
        });
    }

    private async handleStartCapture(
        node: NodeName,
        capture: string,
        filters: CaptureFilters,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const podCommand = `/bin/sh -c "${getTcpDumpCommand(capture, filters)} 1>/dev/null 2>&1 &"`;
        const output = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );
        webview.postStartCaptureResponse({
            node,
            succeeded: output.succeeded,
            errorMessage: failed(output) ? output.error : null,
        });
    }

    private async handleStopCapture(node: NodeName, capture: string, webview: MessageSink<ToWebViewMsgDef>) {
        const runningCaptures = await this.getRunningCaptures(node);
        if (failed(runningCaptures)) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to determine running captures:\n${runningCaptures.error}`,
                capture: null,
            });
            return;
        }

        const captureProcess = runningCaptures.result.find((p) => p.capture === capture);
        if (!captureProcess) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Unable to find running capture ${capture}. Found: ${runningCaptures.result
                    .map((p) => p.capture)
                    .join(",")}`,
                capture: null,
            });
            return;
        }

        const podCommand = `/bin/sh -c "kill ${captureProcess.pid}"`;
        const killOutput = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );
        if (failed(killOutput)) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to kill tcpdump process ${captureProcess.pid}:\n${killOutput.error}`,
                capture: null,
            });
            return;
        }

        const completedCaptures = await this.getCompletedCaptures(node, []);
        if (failed(completedCaptures)) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Failed to read completed captures:\n${completedCaptures.error}`,
                capture: null,
            });
            return;
        }

        const stoppedCapture = completedCaptures.result.find((c) => c.name === capture);
        if (!stoppedCapture) {
            webview.postStopCaptureResponse({
                node,
                succeeded: false,
                errorMessage: `Cannot find capture file for ${capture}`,
                capture: null,
            });
            return;
        }

        webview.postStopCaptureResponse({
            node,
            succeeded: true,
            errorMessage: null,
            capture: stoppedCapture,
        });
    }

    private async handleDownloadCaptureFile(
        node: NodeName,
        captureName: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        const localCaptureUri = await window.showSaveDialog({
            defaultUri: Uri.file(`${captureName}.cap`),
            filters: { "Capture Files": ["cap"] },
            saveLabel: "Download",
            title: "Download Capture File",
        });

        if (!localCaptureUri) {
            return;
        }

        const localCpPath = getLocalKubectlCpPath(localCaptureUri);

        // `kubectl cp` can fail with an EOF error for large files, and there's currently no good workaround:
        // See: https://github.com/kubernetes/kubernetes/issues/60140
        // The best advice I can see is to use the 'retries' option if it is supported, and the
        // 'request-timeout' option otherwise.
        const clientVersion = this.kubectlVersion.clientVersion.gitVersion.replace(/^v/, "");
        const isRetriesOptionSupported = semver.parse(clientVersion) && semver.gte(clientVersion, "1.23.0");
        const cpEOFAvoidanceFlag = isRetriesOptionSupported ? "--retries 99" : "--request-timeout=10m";
        const command = `cp -n ${debugPodNamespace} ${getPodName(
            node,
        )}:${captureFileBasePath}${captureName}.cap ${localCpPath} ${cpEOFAvoidanceFlag}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        if (failed(output)) {
            webview.postDownloadCaptureFileResponse({
                node,
                captureName,
                localCapturePath: localCaptureUri.fsPath,
                succeeded: false,
                errorMessage: `Failed to download ${captureName} to ${localCaptureUri.fsPath}:\n${output.error}`,
            });
            return;
        }

        webview.postDownloadCaptureFileResponse({
            node,
            captureName,
            localCapturePath: localCaptureUri.fsPath,
            succeeded: output.succeeded,
            errorMessage: null,
        });
    }

    private handleOpenFolder(path: string) {
        commands.executeCommand("revealFileInOS", Uri.file(path));
    }

    private async handleGetInterfaces(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        const podCommand = `/bin/sh -c "tcpdump --list-interfaces"`;
        const output = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );
        const interfaces = errmap(output, (sr) =>
            sr.stdout
                .trim()
                .split("\n")
                .map(extractInterfaceName)
                .filter((i) => !!i),
        );
        webview.postGetInterfacesResponse({
            node,
            succeeded: interfaces.succeeded,
            errorMessage: failed(interfaces) ? interfaces.error : null,
            value: failed(interfaces) ? [] : interfaces.result,
        });
    }

    private async handleGetAllNodes(webview: MessageSink<ToWebViewMsgDef>) {
        const command = `get node --no-headers -o custom-columns=":metadata.name"`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        const nodenames = errmap(output, (sr) => sr.stdout.trim().split("\n"));
        webview.postGetAllNodesResponse({
            succeeded: nodenames.succeeded,
            errorMessage: failed(nodenames) ? nodenames.error : null,
            value: failed(nodenames) ? [] : nodenames.result,
        });
    }

    private async handleGetFilterPodsForNode(node: NodeName, webview: MessageSink<ToWebViewMsgDef>) {
        // Consider the `hostNetwork` value when querying pods. Since we're using the IP address of pods for filtering
        // purposes, it doesn't really make sense to include those which use the host's network namespace, since they
        // will all have the same IP address (that of the host). For this reason we exclude pods with hostNetwork==true.
        //
        // From https://kubernetes.io/docs/reference/kubectl/jsonpath/
        // > On Windows, you must double quote any JSONPath template that contains spaces (not single quote ...).
        // > This in turn means that you must use a single quote or escaped double quote around any literals in the template
        const command = `get pods --all-namespaces --field-selector spec.nodeName=${node} -o jsonpath="{range .items[*]}{.metadata.name}{'\\t'}{.status.podIP}{'\\t'}{.spec.hostNetwork}{'\\n'}{end}"`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        const pods = errmap(
            output,
            (sr) =>
                sr.stdout
                    .trim()
                    .split("\n")
                    .map(asFilterPod)
                    .filter((p) => p !== null) as FilterPod[],
        );
        webview.postGetFilterPodsForNodeResponse({
            node,
            succeeded: pods.succeeded,
            errorMessage: failed(pods) ? pods.error : null,
            value: failed(pods) ? [] : pods.result,
        });
    }

    private async getPodNames(): Promise<Errorable<string[]>> {
        const command = `get pod -n ${debugPodNamespace} --no-headers -o custom-columns=":metadata.name"`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        return errmap(output, (sr) => sr.stdout.trim().split("\n"));
    }

    private async waitForPodReady(node: NodeName): Promise<Errorable<void>> {
        const command = `wait pod -n ${debugPodNamespace} --for=condition=ready --timeout=300s ${getPodName(node)}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        return errmap(output, () => undefined);
    }

    private async waitForPodDeleted(node: NodeName): Promise<Errorable<void>> {
        const command = `wait pod -n ${debugPodNamespace} --for=delete --timeout=300s ${getPodName(node)}`;
        const output = await invokeKubectlCommand(this.kubectl, this.kubeConfigFilePath, command);
        return errmap(output, () => undefined);
    }

    private async installDebugTools(node: NodeName): Promise<Errorable<void>> {
        const podCommand = `/bin/sh -c "apt-get update && apt-get install -y tcpdump procps"`;
        const output = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );
        return errmap(output, () => undefined);
    }

    private async getRunningCaptures(node: NodeName): Promise<Errorable<TcpDumpProcess[]>> {
        // List all processes without header columns, including PID, command and args (which contains the command)
        const podCommand = "ps -e -o pid= -o comm= -o args=";
        const output = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );

        const asProcess = (psOutputLine: string): Process => {
            const parts = psOutputLine.trim().split(/\s+/);
            const pid = parseInt(parts[0]);
            const command = parts[1];
            const args = parts.slice(2).join(" ");
            const capture = getCaptureFromCommand(command, args);
            const isTcpDump = capture !== null;
            const process = { pid, command, args, isTcpDump, capture };
            return process;
        };

        return errmap(output, (sr) => sr.stdout.trim().split("\n").map(asProcess).filter(isTcpDump));
    }

    private async getCompletedCaptures(
        node: NodeName,
        runningCaptures: string[],
    ): Promise<Errorable<CompletedCapture[]>> {
        // Use 'find' rather than 'ls' (http://mywiki.wooledge.org/ParsingLs)
        const podCommand = `find ${captureDir} -type f -name ${captureFilePrefix}*.cap -printf "%p\\t%k\\n"`;
        const output = await getExecOutput(
            this.kubectl,
            this.kubeConfigFilePath,
            debugPodNamespace,
            getPodName(node),
            podCommand,
        );

        const asCompletedCapture = (findOutputLine: string): CompletedCapture => {
            const parts = findOutputLine.trim().split("\t");
            const filePath = parts[0];
            const sizeInKB = parseInt(parts[1]);
            const name = getCaptureFromFilePath(filePath);
            if (name === null) {
                const errorMessage = `Error extracting capture name from ${findOutputLine}`;
                window.showErrorMessage(errorMessage);
                throw new Error(errorMessage);
            }

            return { name, sizeInKB };
        };

        return errmap(output, (sr) =>
            sr.stdout
                .trim()
                .split("\n")
                .filter((line) => line.length > 0)
                .map(asCompletedCapture)
                .filter((cap) => !runningCaptures.some((c) => cap.name === c)),
        );
    }
}

type Process = {
    pid: number;
    command: string;
    args: string;
    isTcpDump: boolean;
};

type TcpDumpProcess = Process & {
    isTcpDump: true;
    capture: string;
};

function isTcpDump(process: Process): process is TcpDumpProcess {
    return process.isTcpDump;
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

function extractInterfaceName(listInterfacesOutputLine: string): string {
    // `tcpdump --list-interfaces` output lines look like:
    // 1.eth0 [Up, Running]
    // Here we extract just the interface name, e.g. `eth0`.
    const match = listInterfacesOutputLine.trim().match(/^\d+\.(\S+)\s.*$/);
    if (!match) return "";
    return match && match[1];
}

function asFilterPod(podOutputLine: string): FilterPod | null {
    // Output line is formatted as:
    // <podname>\t<ipaddress>[\t<hostNetwork>]
    const parts = podOutputLine.trim().split("\t");
    if (parts.length < 2) return null;
    const usesHostNetwork = parts.length > 2 && parts[2] === "true";
    if (usesHostNetwork) return null;
    return {
        name: parts[0],
        ipAddress: parts[1],
    };
}
