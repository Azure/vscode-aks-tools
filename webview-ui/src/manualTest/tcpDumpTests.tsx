import { MessageHandler } from "../../../src/webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { TcpDump } from "../TCPDump/TcpDump";
import { Scenario } from "../utilities/manualTest";
import { getTestVscodeMessageContext } from "../utilities/vscode";

export function getTCPDumpScenarios() {
    const clusterName = "test-cluster";
    const initialState: InitialState = {
        clusterName,
        allNodes: ["test-node"],
    }

    const webview = getTestVscodeMessageContext<"tcpDump">();

    function getMessageHandler(succeeding: boolean): MessageHandler<ToVsCodeMsgDef> {
        return {
            startDebugPod: args => handleStartDebugPod(args.node),
            startTcpDump: args => handleStartTcpDump(args.node),
            endTcpDump: args => handleEndTcpDump(args.node),
            downloadCaptureFile: args => handleDownloadCpatureFile(args.node, args.localcapfile)
        }
    }

    async function handleStartDebugPod(node: string) {
        
    }

    async function handleStartTcpDump(node: string) {
        
    }

    async function handleEndTcpDump(node: string) {
        
    }

    async function handleDownloadCpatureFile(node: string, localcapfile: string) {
        
    }

    return [
        Scenario.create(`TcpDump`, () => <TcpDump {...initialState} />).withSubscription(webview, getMessageHandler(true))
    ];
}
