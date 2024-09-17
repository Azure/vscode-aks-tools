import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { KaitoModels } from "../Kaito/KaitoModels";
import { stateUpdater } from "../Kaito/state";
import { Scenario } from "../utilities/manualTest";

export function getKaitoModelScenarios() {
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
        Scenario.create("kaito", "Models", () => <KaitoModels />, getMessageHandler, stateUpdater.vscodeMessageHandler),
    ];
}
