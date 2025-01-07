import { Uri } from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    // HubClusterMode,
    // ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
    // ResourceGroup as WebviewResourceGroup,
} from "../webview-contract/webviewDefinitions/createFleet";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksFleetClient, getFeatureClient, getResourceManagementClient } from "../commands/utils/arm";
import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";
import { ResourceManagementClient } from "@azure/arm-resources";
import { FeatureClient } from "@azure/arm-features";

export class CreateFleetPanel extends BasePanel<"createFleet"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "createFleet", {
            getLocationsResponse: null,
            getResourceGroupsResponse: null,
            progressUpdate: null,
        });
    }
}

export class CreateFleetDataProvider implements PanelDataProvider<"createFleet"> {
    private readonly resourceManagementClient: ResourceManagementClient;
    private readonly fleetClient: ContainerServiceFleetClient;
    private readonly featureClient: FeatureClient;
    // private readonly commandId: string;

    constructor(
        private readonly sessionProvider: ReadyAzureSessionProvider,
        private readonly subscriptionId: string,
        private readonly subscriptionName: string,
        // commandId: string,
    ) {
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.fleetClient = getAksFleetClient(sessionProvider, this.subscriptionId);
        this.featureClient = getFeatureClient(sessionProvider, this.subscriptionId);
        // this.commandId = commandId;
        console.log(this.resourceManagementClient, this.featureClient, this.sessionProvider);
    }

    getTitle(): string {
        return "Create Fleet";
    }

    getInitialState(): InitialState {
        return {
            subscriptionId: this.subscriptionId,
            subscriptionName: this.subscriptionName,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"createFleet"> {
        return {
            getResourceGroupsRequest: false,
            getLocationsRequest: false,
            createFleetRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getLocationsRequest: () => this.handleGetLocationsRequest(webview),
            getResourceGroupsRequest: () => this.handleGetResourceGroupsRequest(webview),
            createFleetRequest: (args) =>
                this.handleCreateFleetRequest(
                    args.isNewResourceGroup,
                    args.resourceGroupName,
                    args.location,
                    args.name,
                ),
            // args.isNewResourceGroup,
            // args.resourceGroupName,
            // args.location,
            // args.name,
            // args.hubClusterMode,
            // webview,
        };
    }

    private handleGetLocationsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        console.log(webview);
    }

    private handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        console.log(webview);
    }

    private async handleCreateFleetRequest(
        isNewResourceGroup: boolean,
        resourceGroupName: string,
        location: string,
        name: string,
        // hubClusterMode: HubClusterMode,
        // webview: MessageSink<ToWebViewMsgDef>,
    ) {
        if (isNewResourceGroup) {
            // create new resource group
        }

        const resource = {
            location: location,
        };

        try {
            await createFleet(this.fleetClient, resourceGroupName, name, resource);
        } catch (error) {
            console.log(error);
        }
    }
}

async function createFleet(
    client: ContainerServiceFleetClient,
    groupName: string,
    name: string,
    resource: Fleet,
    // sessionProvider: ReadyAzureSessionProvider,
    // subscriptionId: string,
    // location: string,
    // hubClusterMode: HubClusterMode,
    // more to add
) {
    try {
        const result = await client.fleets.beginCreateOrUpdateAndWait(groupName, name, resource);
        return { succeeded: true, result: result.name! };
    } catch (error) {
        return { succeeded: false, error: (error as Error).message };
    }
}
