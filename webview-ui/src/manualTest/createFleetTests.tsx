import { Scenario } from "../utilities/manualTest";
import { CreateFleet } from "../CreateFleet/CreateFleet";
import {
    HubMode,
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
        subscriptionId: "7f9c8a5b-3e9d-4f1c-8c0f-6a3b2a0d2e7c",
        subscriptionName: "Test Sub",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => handleGetResourceGroupsRequest(webview),
            createFleetRequest: (args) =>
                handleCreateFleetRequest(
                    args.resourceGroupName,
                    args.location,
                    args.name,
                    args.hubMode,
                    args.dnsPrefix,
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
        groupName: string,
        location: string,
        name: string,
        hubMode: HubMode,
        dnsPrefix: string | null,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        webview.postProgressUpdate({
            operationDescription: `Successfully created ${groupName} in ${location}`,
            event: ProgressEventType.InProgress,
            errorMessage: null,
            deploymentPortalUrl: null,
            createdFleet: null,
        });

        const deploymentPortalUrl = `https://portal.azure.com/#resource/subscriptions/${initialState.subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.Resources/deployments/testdeployment?referrer_source=vscode&referrer_context=vscode-aks-tools-test`;
        webview.postProgressUpdate({
            operationDescription: `Creating Fleet ${name}`,
            event: ProgressEventType.InProgress,
            errorMessage: null,
            deploymentPortalUrl,
            createdFleet: null,
        });

        let waitMs;
        switch (location) {
            case cancelLocationMarker:
                waitMs = 3000;
                break;
            case failLocationMarker:
                waitMs = 500;
                break;
            default:
                waitMs = 10000;
                break;
        }

        const event =
            location === failLocationMarker
                ? ProgressEventType.Failed
                : location === cancelLocationMarker
                  ? ProgressEventType.Cancelled
                  : ProgressEventType.Success;

        const errorMessage = event === ProgressEventType.Failed ? "Mistakes were made" : null;

        await new Promise((resolve) => setTimeout(resolve, waitMs));
        webview.postProgressUpdate({
            operationDescription: "Creating Fleet",
            event,
            errorMessage,
            deploymentPortalUrl,
            createdFleet:
                event === ProgressEventType.Success
                    ? {
                          portalUrl: `https://portal.azure.com/#resource/subscriptions/${initialState.subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.ContainerService/fleets/${name}?referrer_source=vscode&referrer_context=vscode-aks-tools-test`,
                      }
                    : null,
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
