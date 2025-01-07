import { Scenario } from "../utilities/manualTest";
import { CreateFleet } from "../CreateFleet/CreateFleet";
import {
    HubClusterMode,
    InitialState,
    ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { stateUpdater } from "../CreateFleet/helpers/state";

const failLocationMarker = "thiswillfail";
const cancelLocationMarker = "thiswillbecancelled";
const locations = [
    "westus",
    "eastus",
    "northus",
    "southus",
    "centralus",
    "notus",
    failLocationMarker,
    cancelLocationMarker,
];
const resourceGroups = locations.map((l) => ({ name: `rg_${l}`, location: l }));

export function getCreateFleetScenarios() {
    const initialState: InitialState = {
        subscriptionId: "359833f5-8592-40b6-8175-edc664e2196a", // AKS Long Running Things
        subscriptionName: "AKS Long Running Things",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => handleGetResourceGroupsRequest(webview),
            createFleetRequest: (args) =>
                handleCreateFleetRequest(
                    args.isNewResourceGroup,
                    args.resourceGroupName,
                    args.location,
                    args.name,
                    args.hubClusterMode,
                    webview,
                ),
        };
    }

    async function handleGetLocationsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        webview.postGetLocationsResponse({ locations: locations });
    }

    async function handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        webview.postGetResourceGroupsResponse({ groups: resourceGroups });
    }

    async function handleCreateFleetRequest(
        isNewResourceGroup: boolean,
        groupName: string,
        location: string,
        name: string,
        hubClusterMode: HubClusterMode,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            webview.postProgressUpdate({
                operationDescription: `Creating Resource Group ${groupName} in ${location}`,
                event: ProgressEventType.InProgress,
                errorMessage: null,
                deploymentPortalUrl: null,
                createdFleet: null,
            });

            await new Promise((resolve) => setTimeout(resolve, 5000));
            webview.postProgressUpdate({
                operationDescription: `Successfully created ${groupName} in ${location}`,
                event: ProgressEventType.InProgress,
                errorMessage: null,
                deploymentPortalUrl: null,
                createdFleet: null,
            });
        }

        const deploymentPortalUrl = `https://portal.azure.com/#resource/subscriptions/${initialState.subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.Resources/deployments/testdeployment?referrer_source=vscode&referrer_context=vscode-aks-tools-test`;
        webview.postProgressUpdate({
            operationDescription: `Creating Fleet ${name}`,
            event: ProgressEventType.InProgress,
            errorMessage: null,
            deploymentPortalUrl,
            createdFleet: null,
        });
    }

    return [
        Scenario.create(
            "createFleet",
            "",
            () => <CreateFleet {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
