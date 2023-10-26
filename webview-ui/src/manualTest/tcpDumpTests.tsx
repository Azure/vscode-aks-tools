import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { CaptureName, CompletedCapture, InitialState, NodeName, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { TcpDump } from "../TCPDump/TcpDump";
import { stateUpdater } from "../TCPDump/state";
import { Scenario } from "../utilities/manualTest";

type TestNodeState = {
    isDebugPodRunning: boolean,
    runningCapture: CaptureName | null,
    completedCaptures: CompletedCapture[]
};

function getInitialNodeState(): TestNodeState {
    return {
        isDebugPodRunning: false,
        runningCapture: null,
        completedCaptures: []
    };
}

const goodNode = "good-node";
const nodeWithRunningDebugPod = "node-with-running-debug-pod";
const nodeThatFailsToCreateDebugPod = "node-that-fails-to-create-debug-pod";
const nodeThatFailsToDeleteDebugPod = "node-that-fails-to-delete-debug-pod";
const nodeThatFailsToStartCapture = "node-that-fails-to-start-capture";
const nodeThatFailsToStopCapture = "node-that-fails-to-stop-capture";
const nodeWhereDownloadsFail = "node-where-downloads-fail";

const randomFileSize = () => ~~(Math.random() * 5000);

export function getTCPDumpScenarios() {
    const clusterName = "test-cluster";
    let nodeStates: {[node: NodeName]: TestNodeState} = {
        [goodNode]: getInitialNodeState(),
        [nodeWithRunningDebugPod]: {
            isDebugPodRunning: true,
            runningCapture: null,
            completedCaptures: Array.from({length: 8}, (_, i) => ({name: String(i + 1).padStart(4, '0'), sizeInKB: randomFileSize()}))
        },
        [nodeThatFailsToCreateDebugPod]: getInitialNodeState(),
        [nodeThatFailsToDeleteDebugPod]: getInitialNodeState(),
        [nodeThatFailsToStartCapture]: getInitialNodeState(),
        [nodeThatFailsToStopCapture]: getInitialNodeState(),
        [nodeWhereDownloadsFail]: getInitialNodeState()
    }
    const initialState: InitialState = {
        clusterName,
        allNodes: Object.keys(nodeStates),
    }

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            checkNodeState: args => handleCheckNodeState(args.node),
            startDebugPod: args => handleStartDebugPod(args.node),
            deleteDebugPod: args => handleDeleteDebugPod(args.node),
            startCapture: args => handleStartCapture(args.node, args.capture),
            stopCapture: args => handleStopCapture(args.node, args.capture),
            downloadCaptureFile: args => handleDownloadCaptureFile(args.node, args.capture),
            openFolder: args => handleOpenFolder(args)
        }

        async function handleCheckNodeState(node: NodeName) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            webview.postCheckNodeStateResponse({
                succeeded: true,
                errorMessage: null,
                node,
                ...nodeStates[node]
            });
        }

        async function handleStartDebugPod(node: NodeName) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const succeeded = node !== nodeThatFailsToCreateDebugPod;
            if (succeeded) {
                nodeStates[node] = {
                    isDebugPodRunning: succeeded,
                    runningCapture: null,
                    completedCaptures: []
                };
            }

            webview.postStartDebugPodResponse({
                node,
                succeeded,
                errorMessage: succeeded ? null : "Creating the debug pod didn't work. Sorry."
            });
        }

        async function handleDeleteDebugPod(node: NodeName) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const succeeded = node !== nodeThatFailsToDeleteDebugPod;
            if (succeeded) {
                nodeStates[node] = getInitialNodeState();
            }

            webview.postDeleteDebugPodResponse({
                node,
                succeeded: true,
                errorMessage: succeeded ? null : "Deleting the debug pod didn't work. Sorry."
            });
        }
    
        async function handleStartCapture(node: NodeName, capture: CaptureName) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const succeeded = node !== nodeThatFailsToStartCapture;
            if (succeeded) {
                nodeStates[node] = {...nodeStates[node], runningCapture: capture};
            }

            webview.postStartCaptureResponse({
                node,
                succeeded,
                errorMessage: succeeded ? null : "Starting the capture didn't work. Sorry."
            });
        }
    
        async function handleStopCapture(node: NodeName, capture: CaptureName) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const nodeState = nodeStates[node];

            const succeeded = node !== nodeThatFailsToStartCapture;
            let stoppedCapture = null;
            if (succeeded) {
                stoppedCapture = {name: capture, sizeInKB: randomFileSize()};
                nodeStates[node] = {...nodeState, runningCapture: null, completedCaptures: [...nodeState.completedCaptures, stoppedCapture]};
            }

            webview.postStopCaptureResponse({
                node,
                succeeded,
                errorMessage: succeeded ? null : "Stopping the capture didn't work. Sorry.",
                capture: stoppedCapture
            });
        }
    
        async function handleDownloadCaptureFile(node: NodeName, capture: CaptureName) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            webview.postDownloadCaptureFileResponse({
                node,
                succeeded: true,
                errorMessage: null,
                captureName: capture,
                localCapturePath: `/reasonably/long/path/to/eventually/get/to/${capture}.cap`
            });
        }

        function handleOpenFolder(path: string) {
            alert(`VS Code would launch an OS file system browser here:\n${path}`);
        }
    }

    return [
        Scenario.create("tcpDump", "", () => <TcpDump {...initialState} />, getMessageHandler, stateUpdater.vscodeMessageHandler)
    ];
}
