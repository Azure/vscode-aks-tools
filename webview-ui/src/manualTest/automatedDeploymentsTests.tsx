import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/automatedDeployments";
import { stateUpdater } from "../AutomatedDeployments/state";
import { Scenario } from "../utilities/manualTest";
import { AutomatedDeployments } from "../AutomatedDeployments/AutomatedDeployments";

//Proper testing not yet implemented. Only serves as placeholder and way to load the page.
export function getAutomatedDeploymentScenarios() {
    const initialState: InitialState = {
        repos: ["..."],
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getGitHubReposRequest: () => {
                // implementation here
                webview.postGetGitHubReposResponse({ repos: initialState.repos });
            },
            getSubscriptionsRequest: () => {
                // implementation here
            },
            createWorkflowRequest: () => {
                // implementation here
            },
            getResourceGroupsRequest: () => {
                // implementation here
            },
        };
    }

    return [
        Scenario.create(
            "automatedDeployments",
            "Automated Deployment Placeholder Page",
            () => <AutomatedDeployments {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
