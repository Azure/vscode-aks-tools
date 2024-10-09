import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ModelDetails,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/kaito";
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

                // wait for 5 seconds
                setTimeout(() => {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Kaito Federated Credentials and role Assignments",
                        event: 1,
                        errorMessage: undefined,
                        models: [],
                    });
                }, 5000);

                // wait for 10 seconds
                setTimeout(() => {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Kaito installed successfully",
                        event: 4,
                        errorMessage: undefined,
                        models: listKaitoSupportedModels(),
                    });
                }, 10000);
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
            "Installation Page",
            () => <Kaito {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}

function listKaitoSupportedModels(): ModelDetails[] {
    // sample model details array
    return [
        {
            family: "Family1",
            modelName: "Model1",
            minimumGpu: 1,
            kaitoVersion: "1.0",
            modelSource: "source",
        },
    ];
}
