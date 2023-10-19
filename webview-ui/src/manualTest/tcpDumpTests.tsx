import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { TcpDump } from "../TCPDump/TcpDump";
import { stateUpdater } from "../TCPDump/state";
import { Scenario } from "../utilities/manualTest";

export function getTCPDumpScenarios() {
    const clusterName = "test-cluster";
    const initialState: InitialState = {
        clusterName,
        allNodes: ["test-node"],
    }

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            startDebugPod: args => handleStartDebugPod(args.node),
            startTcpDump: args => handleStartTcpDump(args.node),
            endTcpDump: args => handleEndTcpDump(args.node),
            downloadCaptureFile: args => handleDownloadCpatureFile(args.node, args.localcapfile)
        }

        async function handleStartDebugPod(node: string) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            webview.postStartDebugPodResponse({succeeded: true, errorMessage: null});
        }
    
        async function handleStartTcpDump(node: string) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            webview.postStartTcpDumpResponse({succeeded: true, errorMessage: null});
        }
    
        async function handleEndTcpDump(node: string) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            webview.postEndTcpDumpResponse({succeeded: true, errorMessage: null});
        }
    
        async function handleDownloadCpatureFile(node: string, localcapfile: string) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            webview.postDownloadCaptureFileResponse({succeeded: true, errorMessage: null});
        }
    }

    return [
        Scenario.create("tcpDump", "", () => <TcpDump {...initialState} />, getMessageHandler, stateUpdater.vscodeMessageHandler)
    ];
}
