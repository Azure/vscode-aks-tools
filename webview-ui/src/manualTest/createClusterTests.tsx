import { Scenario } from "../utilities/manualTest";
import { CreateCluster } from "../CreateCluster/CreateCluster";
import {
    InitialState,
    ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { stateUpdater } from "../CreateCluster/helpers/state";

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

export function getCreateClusterScenarios() {
    const initialState: InitialState = {
        subscriptionId: "7f9c8a5b-3e9d-4f1c-8c0f-6a3b2a0d2e7c",
        subscriptionName: "Test Sub",
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => handleGetResourceGroupsRequest(webview),
            createClusterRequest: (args) =>
                handleCreateClusterRequest(
                    args.isNewResourceGroup,
                    args.resourceGroupName,
                    args.location,
                    args.name,
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

    async function handleCreateClusterRequest(
        isNewResourceGroup: boolean,
        groupName: string,
        location: string,
        name: string,
        webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            webview.postProgressUpdate({
                operationDescription: `Creating Resource Group ${groupName} in ${location}`,
                event: ProgressEventType.InProgress,
                errorMessage: null,
                deploymentPortalUrl: null,
                createdCluster: null,
            });

            await new Promise((resolve) => setTimeout(resolve, 5000));
            webview.postProgressUpdate({
                operationDescription: `Successfully created ${groupName} in ${location}`,
                event: ProgressEventType.InProgress,
                errorMessage: null,
                deploymentPortalUrl: null,
                createdCluster: null,
            });
        }

        const deploymentPortalUrl = `https://portal.azure.com/#resource/subscriptions/${initialState.subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.Resources/deployments/testdeployment?referrer_source=vscode&referrer_context=vscode-aks-tools-test`;
        webview.postProgressUpdate({
            operationDescription: `Creating Cluster ${name}`,
            event: ProgressEventType.InProgress,
            errorMessage: null,
            deploymentPortalUrl,
            createdCluster: null,
        });

        const waitMs = location === failLocationMarker ? 500 : location === cancelLocationMarker ? 3000 : 10000;

        const event =
            location === failLocationMarker
                ? ProgressEventType.Failed
                : location === cancelLocationMarker
                  ? ProgressEventType.Cancelled
                  : ProgressEventType.Success;

        const errorMessage = event === ProgressEventType.Failed ? "Mistakes were made" : null;

        await new Promise((resolve) => setTimeout(resolve, waitMs));
        webview.postProgressUpdate({
            operationDescription: "Creating Cluster",
            event,
            errorMessage,
            deploymentPortalUrl,
            createdCluster:
                event === ProgressEventType.Success
                    ? {
                          portalUrl: `https://portal.azure.com/#resource/subscriptions/${initialState.subscriptionId}/resourceGroups/${groupName}/providers/Microsoft.ContainerService/managedClusters/${name}?referrer_source=vscode&referrer_context=vscode-aks-tools-test`,
                      }
                    : null,
        });
    }

    return [
        Scenario.create(
            "createCluster",
            "",
            () => <CreateCluster {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
