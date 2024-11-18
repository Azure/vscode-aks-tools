import { MessageHandler } from "../../../src/webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaitoTest";
import { KaitoTest } from "../KaitoTest/KaitoTest";
import { stateUpdater } from "../KaitoTest/state";
import { Scenario } from "../utilities/manualTest";

export function getKaitoTestScenarios() {
    const initialState: InitialState = {
        clusterName: "ai-service",
        modelName: "falcon-7b-instruct",
        output: "What is the meaning of life?\n\nThe meaning of life is to be happy.",
    };

    function getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
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
