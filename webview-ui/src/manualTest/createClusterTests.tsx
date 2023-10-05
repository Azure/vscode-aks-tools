import { Scenario } from "../utilities/manualTest";
import { CreateCluster } from "../CreateCluster/CreateCluster";
import { getTestVscodeMessageContext } from "../utilities/vscode";
import { InitialState, ProgressEventType, ResourceGroup } from "../../../src/webview-contract/webviewDefinitions/createCluster";
import { ToVsCodeMessageHandler } from "../../../src/webview-contract/webviewTypes";

const failLocationMarker = "thiswillfail";
const cancelLocationMarker = "thiswillbecancelled";
const locations =  ["westus", "eastus", "northus", "southus", "centralus", "notus", failLocationMarker, cancelLocationMarker];
const resourceGroups = locations.map(l => ({name: `rg_${l}`, location: l}));

export function getCreateClusterScenarios() {
    const initialState: InitialState = {
        portalUrl: "https://portal.azure.com/",
        portalReferrerContext: "vscode-aks-tools-test",
        subscriptionId: "7f9c8a5b-3e9d-4f1c-8c0f-6a3b2a0d2e7c",
        subscriptionName: "Test Sub"
    };

    const webview = getTestVscodeMessageContext<"createCluster">();
    const messageHandler: ToVsCodeMessageHandler<"createCluster"> = {
        getLocationsRequest: handleGetLocationsRequest,
        getResourceGroupsRequest: handleGetResourceGroupsRequest,
        createClusterRequest: args => handleCreateClusterRequest(args.isNewResourceGroup, args.resourceGroup, args.location, args.name)
    };

    async function handleGetLocationsRequest() {
        await new Promise(resolve => setTimeout(resolve, 1000));
        webview.postMessage({
            command: "getLocationsResponse",
            parameters: {locations: locations}
        });
    }

    async function handleGetResourceGroupsRequest() {
        await new Promise(resolve => setTimeout(resolve, 1000));
        webview.postMessage({
            command: "getResourceGroupsResponse",
            parameters: {groups: resourceGroups}
        });
    }

    async function handleCreateClusterRequest(isNewResourceGroup: boolean, group: ResourceGroup, location: string, name: string) {
        if (isNewResourceGroup) {
            webview.postMessage({
                command: "progressUpdate",
                parameters: {
                    operationDescription: `Creating Resource Group ${group.name} in ${group.location}`,
                    event: ProgressEventType.InProgress,
                    errorMessage: null
                }
            });

            await new Promise(resolve => setTimeout(resolve, 5000));
            webview.postMessage({
                command: "progressUpdate",
                parameters: {
                    operationDescription: `Successfully created ${group.name} in ${group.location}`,
                    event: ProgressEventType.InProgress,
                    errorMessage: null
                }
            });
        }

        webview.postMessage({
            command: "progressUpdate",
            parameters: {
                operationDescription: "Creating Cluster",
                event: ProgressEventType.InProgress,
                errorMessage: null
            }
        });

        const waitMs =
            location === failLocationMarker ? 500 :
            location === cancelLocationMarker ? 3000 :
            10000;

        const event =
            location === failLocationMarker ? ProgressEventType.Failed :
            location === cancelLocationMarker ? ProgressEventType.Cancelled :
            ProgressEventType.Success;

        const errorMessage = event === ProgressEventType.Failed ? "Mistakes were made" : null;

        await new Promise(resolve => setTimeout(resolve, waitMs));
        webview.postMessage({
            command: "progressUpdate",
            parameters: {
                operationDescription: "Creating Cluster",
                event,
                errorMessage
            }
        });
    }

    return [
        Scenario.create("Create Cluster", () => <CreateCluster {...initialState} />).withSubscription(webview, messageHandler)
    ];
}