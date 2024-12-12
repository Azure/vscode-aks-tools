import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kaitoTest";
import { KaitoTest } from "../KaitoTest/KaitoTest";
import { stateUpdater } from "../KaitoTest/state";
import { Scenario } from "../utilities/manualTest";

export function getKaitoTestScenarios() {
    const initialState: InitialState = {
        clusterName: "ai-service",
        modelName: "falcon-7b-instruct",
        output: "",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            queryRequest: (params) => {
                console.log("queryRequest", params);
                webview.postTestUpdate({
                    clusterName: initialState.clusterName,
                    modelName: initialState.modelName,
                    output: "What is the meaning of life?\n\nThe meaning of life is to be happy. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim i",
                });
            },
        };
    }

    return [
        Scenario.create(
            "kaitoTest",
            "Test Page",
            () => <KaitoTest {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
