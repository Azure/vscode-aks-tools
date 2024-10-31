import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";
import { KaitoManage } from "../KaitoManage/KaitoManage";
import { stateUpdater } from "../KaitoManage/state";
import { Scenario } from "../utilities/manualTest";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";

export function getKaitoManageScenarios() {
    const initialState: InitialState = {
        clusterName: "Kaito cluster",
        models: [
            {
                name: "example-model-1",
                instance: "Standard_NC12s_v3",
                resourceReady: null,
                inferenceReady: null,
                workspaceReady: null,
                age: 10,
            },
            {
                name: "example-model-2",
                instance: "Standard_NC12s_v3",
                resourceReady: true,
                inferenceReady: true,
                workspaceReady: true,
                age: 30,
            },
            {
                name: "example-model-3",
                instance: "Standard_NC12s_v3",
                resourceReady: false,
                inferenceReady: false,
                workspaceReady: false,
                age: 300,
            },
        ],
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        void webview;
        return {
            monitorUpdateRequest: ({ models }) => {
                console.log("monitorUpdateRequest", models);
            },
            deleteWorkspaceRequest: ({ model }) => {
                console.log("deleteWorkspaceRequest", model);
            },
        };
    }

    return [
        Scenario.create(
            "kaitoManage",
            "Manage",
            () => <KaitoManage {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
