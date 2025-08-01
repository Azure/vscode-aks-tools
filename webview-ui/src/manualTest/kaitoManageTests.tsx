import { MessageHandler } from "../../../src/webview-contract/messaging";
import { ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";
import { KaitoManage } from "../KaitoManage/KaitoManage";
import { stateUpdater } from "../KaitoManage/state";
import { Scenario } from "../utilities/manualTest";
import { InitialState } from "../../../src/webview-contract/webviewDefinitions/kaitoManage";

export function getKaitoManageScenarios() {
    const initialState: InitialState = {
        clusterName: "ai-chat-service",
        models: [
            {
                name: "falcon-7b-instruct",
                instance: "Standard_NC12s_v3",
                resourceReady: null,
                inferenceReady: null,
                workspaceReady: null,
                age: 4,
                namespace: "default",
            },
            {
                name: "phi-2",
                instance: "Standard_NC6s_v3",
                resourceReady: true,
                inferenceReady: true,
                workspaceReady: true,
                age: 43,
                namespace: "default",
            },
            {
                name: "phi-3-medium-128k-instruct",
                instance: "Standard_NC24ads_A100_v4",
                resourceReady: false,
                inferenceReady: false,
                workspaceReady: false,
                age: 381,
                namespace: "default",
            },
        ],
    };

    function getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {
            monitorUpdateRequest: () => {
                console.log("monitorUpdateRequest");
            },
            deleteWorkspaceRequest: ({ model }) => {
                console.log("deleteWorkspaceRequest", model);
            },
            redeployWorkspaceRequest: ({ modelName, modelYaml }) => {
                console.log("redeployWorkspaceRequest", modelName, modelYaml);
            },
            getLogsRequest: () => {
                console.log("getLogsRequest");
            },
            testWorkspaceRequest: ({ modelName, namespace }) => {
                console.log("testWorkspaceRequest", modelName, namespace);
            },
            portForwardRequest: ({ modelName, namespace }) => {
                console.log("portForwardRequest", modelName, namespace);
            },
        };
    }

    return [
        Scenario.create(
            "kaitoManage",
            "Manage Page",
            () => <KaitoManage {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
