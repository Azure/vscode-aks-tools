import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { Uri, window } from "vscode";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import {
    InitialState,
    ProgressEventType,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/createFleet";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksFleetClient, getResourceManagementClient } from "../commands/utils/arm";
import { getResourceGroups } from "../commands/utils/resourceGroups";
import { failed } from "../commands/utils/errorable";

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

    constructor(
        private readonly sessionProvider: ReadyAzureSessionProvider,
        private readonly subscriptionId: string,
        private readonly subscriptionName: string,
    ) {
        this.resourceManagementClient = getResourceManagementClient(sessionProvider, this.subscriptionId);
        this.fleetClient = getAksFleetClient(sessionProvider, this.subscriptionId);
    }

    getTitle(): string {
        return `Create Fleet in ${this.subscriptionName}`;
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
                this.handleCreateFleetRequest(args.resourceGroupName, args.location, args.name),
        };
    }

    private async handleGetLocationsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const provider = await this.resourceManagementClient.providers.get("Microsoft.ContainerService");
        const resourceTypes = provider.resourceTypes?.filter((type) => type.resourceType === "fleets");
        if (!resourceTypes || resourceTypes.length > 1) {
            window.showErrorMessage(
                `Unexpected number of fleets resource types for provider (${resourceTypes?.length || 0}).`,
            );
            return;
        }

        const resourceType = resourceTypes[0];
        if (!resourceType.locations || resourceType.locations.length === 0) {
            window.showErrorMessage("No locations found for fleets resource type.");
            return;
        }

        webview.postGetLocationsResponse({ locations: resourceType.locations });
    }

    private async handleGetResourceGroupsRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const groups = await getResourceGroups(this.sessionProvider, this.subscriptionId);
        if (failed(groups)) {
            webview.postProgressUpdate({
                event: ProgressEventType.Failed,
                operationDescription: "Retrieving resource groups for fleet creation",
                errorMessage: groups.error,
                deploymentPortalUrl: null,
                createdFleet: null,
            });
            return;
        }

        const usableGroups = groups.result
            .map((group) => ({
                label: `${group.name} (${group.location})`,
                name: group.name,
                location: group.location,
            }))
            .sort((a, b) => (a.name > b.name ? 1 : -1));

        webview.postGetResourceGroupsResponse({ groups: usableGroups });
    }

    private async handleCreateFleetRequest(resourceGroupName: string, location: string, name: string) {
        const resource = {
            location: location,
        };

        await createFleet(this.fleetClient, resourceGroupName, name, resource);
    }
}

export async function createFleet(
    client: ContainerServiceFleetClient,
    resourceGroupName: string,
    name: string,
    resource: Fleet,
) {
    try {
        const result = await client.fleets.beginCreateOrUpdateAndWait(resourceGroupName, name, resource);
        return { succeeded: true, result: result.name! };
    } catch (error) {
        return { succeeded: false, error: (error as Error).message };
    }
}
