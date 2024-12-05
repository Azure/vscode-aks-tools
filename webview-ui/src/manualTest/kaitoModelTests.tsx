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
            generateCRDRequest: ({ model }) => {
                console.log("monitorUpdateRequest", model);
            },
            deployKaitoRequest: ({ model, yaml, gpu }) => {
                console.log("monitorUpdateRequest", model, yaml, gpu);
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
            workspaceExistsRequest: ({ model }) => {
                console.log("monitorUpdateRequest", model);
            },
            updateStateRequest: ({ model }) => {
                console.log("monitorUpdateRequest", model);
            },
            resetStateRequest: () => {
                console.log("monitorUpdateRequest");
            },
            cancelRequest: ({ model }) => {
                console.log("monitorUpdateRequest", model);
                webview.postDeploymentProgressUpdate(initialState);
            },
            kaitoManageRedirectRequest: () => {
                console.log("monitorUpdateRequest");
            },
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
