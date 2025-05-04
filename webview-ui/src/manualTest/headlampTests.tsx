import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/headlamp";
import { Headlamp } from "../Headlamp/Headlamp";
import { stateUpdater } from "../Headlamp/state";
import { Scenario } from "../utilities/manualTest";

export function getHeadlampScenarios() {
    const initialState: InitialState = {
        deploymentStatus: "undeployed",
        token: "",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            deployHeadlampRequest: (params) => {
                console.log("deployHeadlampRequest", params);
                webview.postHeadlampUpdate({
                    deploymentStatus: "deploying",
                    token: "",
                });

                setTimeout(() => {
                    webview.postHeadlampUpdate({
                        deploymentStatus: "deployed",
                        token: "",
                    });
                }, 2000);
            },
            generateTokenRequest: (params) => {
                console.log("generateTokenRequest", params);
                webview.postHeadlampUpdate({
                    deploymentStatus: "deployed",
                    token: "generated-token",
                });
            },
            startPortForwardingRequest: (params) => {
                console.log("startPortForwardingRequest", params);
            },
            stopPortForwardingRequest: (params) => {
                console.log("stopPortForwardingRequest", params);
            },
        };
    }

    return [
        Scenario.create(
            "headlamp",
            "Test Page",
            () => <Headlamp {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
