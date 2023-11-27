import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    CommandCategory,
    InitialState,
    PresetCommand,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kubectl";
import { Kubectl } from "../Kubectl/Kubectl";
import { stateUpdater } from "../Kubectl/helpers/state";
import { Scenario } from "../utilities/manualTest";

const customCommands: PresetCommand[] = [
    { name: "Test 1", command: "get things", category: CommandCategory.Custom },
    { name: "Test 2", command: "get other things", category: CommandCategory.Custom },
];

export function getKubectlScenarios() {
    const clusterName = "test-cluster";
    const initialState: InitialState = {
        clusterName,
        customCommands,
    };

    function getMessageHandler(
        webview: MessageSink<ToWebViewMsgDef>,
        succeeding: boolean,
    ): MessageHandler<ToVsCodeMsgDef> {
        return {
            runCommandRequest: (args) => handleRunCommandRequest(args.command, succeeding, webview),
            addCustomCommandRequest: () => undefined,
            deleteCustomCommandRequest: () => undefined,
        };
    }

    async function handleRunCommandRequest(
        command: string,
        succeeding: boolean,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (succeeding) {
            webview.postRunCommandResponse({
                output: Array.from(
                    { length: 20 },
                    (_, i) =>
                        `This is the output of "kubectl ${command}" line ${
                            i + 1
                        } and it's quite a long line so that we can adequately test whether the output scrolls or wraps correctly.`,
                ).join("\n"),
                errorMessage: "",
            });
        } else {
            webview.postRunCommandResponse({
                output: null,
                errorMessage: "Something went wrong and this is the error.",
            });
        }
    }

    return [
        Scenario.create(
            "kubectl",
            "succeeding",
            () => <Kubectl {...initialState} />,
            (webview) => getMessageHandler(webview, true),
            stateUpdater.vscodeMessageHandler,
        ),
        Scenario.create(
            "kubectl",
            "failing",
            () => <Kubectl {...initialState} />,
            (webview) => getMessageHandler(webview, false),
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
