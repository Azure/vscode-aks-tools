import { MessageHandler } from "../../../src/webview-contract/messaging";
import { AIKeyStatus, CommandCategory, InitialState, PresetCommand, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/kubectl";
import { Kubectl } from "../Kubectl/Kubectl";
import { Scenario } from "../utilities/manualTest";
import { getTestVscodeMessageContext } from "../utilities/vscode";

const customCommands: PresetCommand[] = [
    {name: "Test 1", command: "get things", category: CommandCategory.Custom},
    {name: "Test 2", command: "get other things", category: CommandCategory.Custom}
];

let apiKey: string | null = null;
let apiKeyStatus = apiKey ? AIKeyStatus.Unverified : AIKeyStatus.Missing;

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
            deleteCustomCommandRequest: _ => undefined,
            getAIKeyStatus: _ => handleGetAIKeyStatus(),
            updateAIKeyRequest: args => handleUpdateAIKeyRequest(args.apiKey)
        }
    }

    async function handleRunCommandRequest(command: string, succeeding: boolean) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (succeeding) {
            webview.postMessage({
                command: "runCommandResponse",
                parameters: {
                    output: Array.from({length: 20}, (_, i) => `This is the output of "kubectl ${command}" line ${i + 1}`).join('\n'),
                    errorMessage: ""
                }
            });
        } else {
            const explanation = "And here's a natural language explanation of what went wrong.";
            let canStream = false;
            if (apiKey === "valid") {
                canStream = true;
                updateAIKeyStatus(AIKeyStatus.Valid, null);
            } else if (!apiKey) {
                updateAIKeyStatus(AIKeyStatus.Missing, null);
            } else {
                updateAIKeyStatus(AIKeyStatus.Invalid, apiKey);
            }

            webview.postMessage({
                command: "runCommandResponse",
                parameters: {
                    output: null,
                    errorMessage: "Something went wrong and this is the error."
                }
            });

            if (canStream) {
                for (const word of explanation.split(" ").map((w, i) => `${i > 0 ? ' ': ''}${w}`)) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    webview.postMessage({
                        command: "appendExplanation",
                        parameters: {
                            chunk: word
                        }
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                webview.postMessage({
                    command: "completeExplanation",
                    parameters: undefined
                });
            }
        }
    }

    function handleGetAIKeyStatus() {
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus: apiKeyStatus, invalidKey: apiKeyStatus === AIKeyStatus.Invalid ? apiKey : null} });
    }

    function handleUpdateAIKeyRequest(newApiKey: string) {
        apiKey = newApiKey;
        updateAIKeyStatus(AIKeyStatus.Unverified, null);
    }

    function updateAIKeyStatus(keyStatus: AIKeyStatus, invalidKey: string | null) {
        apiKeyStatus = keyStatus;
        webview.postMessage({ command: "updateAIKeyStatus", parameters: {keyStatus, invalidKey} });
    }

    return [
        Scenario.create(`Kubectl (succeeding)`, () => <Kubectl {...initialState} />).withSubscription(webview, getMessageHandler(true)),
        Scenario.create(`Kubectl (failing)`, () => <Kubectl {...initialState} />).withSubscription(webview, getMessageHandler(false))
    ];
}
