import { MessageHandler } from "../../../src/webview-contract/messaging";
import { CommandCategory, InitialState, TCPPresetCommand, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { TcpDump } from "../TCPDump/TcpDump";
import { Scenario } from "../utilities/manualTest";
import { getTestVscodeMessageContext } from "../utilities/vscode";

const customCommands: TCPPresetCommand[] = [
    {name: "Test 1", command: "get things", category: CommandCategory.Custom},
    {name: "Test 2", command: "get other things", category: CommandCategory.Custom}
];

export function getTCPDumpScenarios() {
    const clusterName = "test-cluster";
    const initialState: InitialState = {
        clusterName,
        customCommands
    }

    const webview = getTestVscodeMessageContext<"kubectl">();

    function getMessageHandler(succeeding: boolean): MessageHandler<ToVsCodeMsgDef> {
        return {
            runCommandRequest: args => handleRunCommandRequest(args.command, succeeding),
            addCustomCommandRequest: _ => undefined,
            deleteCustomCommandRequest: _ => undefined
        }
    }

    async function handleRunCommandRequest(command: string, succeeding: boolean) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (succeeding) {
            webview.postMessage({
                command: "runCommandResponse",
                parameters: {
                    output: Array.from({length: 20}, (_, i) => `This is the output of "tcpDump ${command}" line ${i + 1}`).join('\n'),
                    errorMessage: ""
                }
            });
        } else {
            webview.postMessage({
                command: "runCommandResponse",
                parameters: {
                    output: null,
                    errorMessage: "Something went wrong and this is the error."
                }
            });
        }
    }

    return [
        Scenario.create(`TcpDump (succeeding)`, () => <TcpDump {...initialState} />).withSubscription(webview, getMessageHandler(true)),
        Scenario.create(`TcpDump (failing)`, () => <TcpDump {...initialState} />).withSubscription(webview, getMessageHandler(false))
    ];
}
