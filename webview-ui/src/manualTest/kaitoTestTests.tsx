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
        output: "What is the meaning of life?\n\nThe meaning of life is to be happy.",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        void webview;
        return {
            queryRequest: (params) => {
                console.log("queryRequest", params);
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
