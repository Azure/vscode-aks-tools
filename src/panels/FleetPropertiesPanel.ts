import { Uri } from "vscode";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { ContainerServiceFleetClient, Fleet } from "@azure/arm-containerservicefleet";
import { ReadyAzureSessionProvider } from "../auth/types";
import { getAksFleetClient } from "../commands/utils/arm";
import {
    FleetInfo,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../webview-contract/webviewDefinitions/fleetProperties";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";
import { MessageHandler, MessageSink } from "../webview-contract/messaging";
import { getFleet } from "../commands/utils/fleet";
import { failed } from "../commands/utils/errorable";

export class FleetPropertiesPanel extends BasePanel<"fleetProperties"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "fleetProperties", {
            getPropertiesResponse: null,
            errorNotification: null,
        });
    }
}

export class FleetPropertiesDataProvider implements PanelDataProvider<"fleetProperties"> {
    private readonly fleetClient: ContainerServiceFleetClient;
    constructor(
        private readonly sessionProvider: ReadyAzureSessionProvider,
        readonly subscriptionId: string,
        readonly resourceGroup: string,
        readonly fleetName: string,
    ) {
        this.fleetClient = getAksFleetClient(this.sessionProvider, this.subscriptionId);
    }

    getTitle(): string {
        return `Fleet Properties for ${this.fleetName}`;
    }

    getInitialState(): InitialState {
        return {
            fleetName: this.fleetName,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"fleetProperties"> {
        return {
            getPropertiesRequest: false,
            refreshRequest: true,
        };
    }

    getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        return {
            getPropertiesRequest: () => this.handleGetPropertiesRequest(webview),
            refreshRequest: () => this.handleGetPropertiesRequest(webview),
        };
    }

    private async handleGetPropertiesRequest(webview: MessageSink<ToWebViewMsgDef>) {
        const fleet = await getFleet(this.fleetClient, this.resourceGroup, this.fleetName);
        if (failed(fleet)) {
            webview.postErrorNotification(fleet.error);
            return;
        }

        webview.postGetPropertiesResponse(asFleetInfo(fleet.result));
    }
}

function asFleetInfo(fleet: Fleet): FleetInfo {
    return {
        provisioningState: fleet.provisioningState!, // getFleet() ensures this is defined
    };
}
