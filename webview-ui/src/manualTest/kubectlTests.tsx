import { MessageHandler } from "../../../src/webview-contract/messaging";
import { CommandCategory, InitialState, PresetCommand, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import { Kubectl } from "../Kubectl/Kubectl";
import { Scenario } from "../utilities/manualTest";
import { getTestVscodeMessageContext } from "../utilities/vscode";

const customCommands: PresetCommand[] = [
    {name: "Test 1", command: "get things", category: CommandCategory.Custom},
    {name: "Test 2", command: "get other things", category: CommandCategory.Custom}
];

export function getKubectlScenarios() {
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
                    output: Array.from({length: 20}, (_, i) => `This is the output of "kubectl ${command}" line ${i + 1}`).join('\n')
                }
            });
        } else {
            webview.postMessage({
                command: "runCommandResponse",
                parameters: {
                    errorMessage: "Something went wrong and this is the error.",
                    explanation: "And here's a natural language explanation of what went wrong."
                }
            });
        }
    }

    return [
        Scenario.create(`Kubectl (succeeding)`, () => <Kubectl {...initialState} />).withSubscription(webview, getMessageHandler(true)),
        Scenario.create(`Kubectl (failing)`, () => <Kubectl {...initialState} />).withSubscription(webview, getMessageHandler(false))
    ];
}
