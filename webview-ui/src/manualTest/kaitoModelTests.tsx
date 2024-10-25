import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { KaitoModels } from "../KaitoModels/KaitoModels";
import { stateUpdater } from "../Kaito/state";
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
            installKaitoRequest: () => {
                console.log("installKaitoRequest");
                webview.postKaitoInstallProgressUpdate({
                    operationDescription: "Installing Kaito",
                    event: 1,
                    errorMessage: undefined,
                    models: [],
                });
            },
            getLLMModelsRequest: () => {
                console.log("getLLMModelsRequest");
            },
            generateWorkspaceRequest: () => {
                console.log("generateWorkspaceRequest");
            },
            deployWorkspace: () => {
                console.log("deployWorkspace");
            },
        };
    }

    return [
        Scenario.create(
            "kaito",
            "Models",
            () => <KaitoModels {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
