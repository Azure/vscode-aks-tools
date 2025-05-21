import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { InitialState, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { Kaito } from "../Kaito/Kaito";
import { stateUpdater } from "../Kaito/state";
import { Scenario } from "../utilities/manualTest";
import { vscode } from "../utilities/vscode";

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
                });

                // wait for 5 seconds
                setTimeout(() => {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Kaito Federated Credentials and role Assignments",
                        event: 1,
                        errorMessage: undefined,
                    });
                }, 5000);

                // wait for 10 seconds
                setTimeout(() => {
                    webview.postKaitoInstallProgressUpdate({
                        operationDescription: "Kaito installed successfully",
                        event: 4,
                        errorMessage: undefined,
                    });
                }, 10000);
            },
            generateWorkspaceRequest: () => {
                console.log("generateWorkspaceRequest");
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
