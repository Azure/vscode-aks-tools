import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { Kaito } from "../Kaito/Kaito";
import { stateUpdater } from "../Kaito/state";
import { Scenario } from "../utilities/manualTest";

export function getKaitoScenarios() {
    const initialState: InitialState = {
        clusterName: "MyCluster",
        subscriptionId: "MySubscriptionId",
        resourceGroupName: "MyResourceGroup",
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
            "",
            () => <Kaito {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
