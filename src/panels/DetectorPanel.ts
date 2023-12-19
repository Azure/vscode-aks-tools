import { Uri } from "vscode";
import { MessageHandler } from "../webview-contract/messaging";
import {
    CategoryDetectorARMResponse,
    InitialState,
    SingleDetectorARMResponse,
    ToVsCodeMsgDef,
} from "../webview-contract/webviewDefinitions/detector";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import { getPortalUrl } from "../commands/utils/detectors";
import { Environment } from "@azure/ms-rest-azure-env";
import { TelemetryDefinition } from "../webview-contract/webviewTypes";

export class DetectorPanel extends BasePanel<"detector"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "detector", {});
    }
}

export class DetectorDataProvider implements PanelDataProvider<"detector"> {
    public constructor(
        readonly environment: Environment,
        readonly clusterName: string,
        readonly categoryDetector: CategoryDetectorARMResponse,
        readonly detectors: SingleDetectorARMResponse[],
    ) {
        this.detectorName = categoryDetector.properties.metadata.name;
        this.detectorDescription = categoryDetector.properties.metadata.description;
        this.detectorPortalUrl = getPortalUrl(environment, categoryDetector);
    }

    readonly detectorName: string;
    readonly detectorDescription: string;
    readonly detectorPortalUrl: string;

    getTitle(): string {
        return `${this.detectorName} diagnostics for ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            name: this.clusterName,
            description: this.detectorDescription,
            portalDetectorUrl: this.detectorPortalUrl,
            detectors: this.detectors,
        };
    }

    getTelemetryDefinition(): TelemetryDefinition<"detector"> {
        return {};
    }

    getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {};
    }
}
