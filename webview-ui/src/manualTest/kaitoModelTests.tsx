import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaitoModels";
import { KaitoModels } from "../KaitoModels/KaitoModels";
import { stateUpdater } from "../KaitoModels/state";
import { Scenario } from "../utilities/manualTest";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoModels";
export function getKaitoModelScenarios() {
    const initialState: InitialState = {
        clusterName: "Kaito cluster",
        modelName: "",
        workspaceExists: false,
        resourceReady: null,
        inferenceReady: null,
        workspaceReady: null,
        age: 0,
    };
    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            generateCRDRequest: () => {},
            deployKaitoRequest: ({ model, yaml, gpu }) => {
                console.log("deployKaitoRequest", model, yaml, gpu);
                webview.postDeploymentProgressUpdate({
                    clusterName: initialState.clusterName,
                    modelName: model,
                    workspaceExists: true,
                    resourceReady: null,
                    inferenceReady: null,
                    workspaceReady: null,
                    age: 0,
                });
            },
            resetStateRequest: () => {},
            cancelRequest: ({ model }) => {
                console.log("cancelRequest", model);
                webview.postDeploymentProgressUpdate(initialState);
            },
            kaitoManageRedirectRequest: () => {},
        };
    }

    return [
        Scenario.create(
            "kaitoModels",
            "Models Page",
            () => <KaitoModels {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
