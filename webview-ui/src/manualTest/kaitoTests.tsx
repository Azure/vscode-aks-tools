import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaito";
import { Kaito } from "../Kaito/Kaito";
import { stateUpdater } from "../Kaito/state";
import { Scenario } from "../utilities/manualTest";

export function getKaitoScenarios() {
    const initialState: InitialState = {
        clusterName: "MyCluster",
        subscriptionId: "MySubscriptionId",
        resourceGroupName: "MyResourceGroup",
    };

    function getMessageHandler() {
        return {
            installKaitoRequest: () => {
                console.log("installKaitoRequest");
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
