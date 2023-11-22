import { Uri } from "vscode";
import { MessageHandler } from "../webview-contract/messaging";
import {
    ARMResponse,
    CategoryDetectorARMResponse,
    InitialState,
    SingleDetectorARMResponse,
    ToVsCodeMsgDef,
} from "../webview-contract/webviewDefinitions/detector";
import { BasePanel, PanelDataProvider } from "./BasePanel";
import meta from "../../package.json";

export class DetectorPanel extends BasePanel<"detector"> {
    constructor(extensionUri: Uri) {
        super(extensionUri, "detector", {});
    }
}

export class DetectorDataProvider implements PanelDataProvider<"detector"> {
    public constructor(
        readonly clusterName: string,
        readonly categoryDetector: CategoryDetectorARMResponse,
        readonly detectors: SingleDetectorARMResponse[],
    ) {
        this.detectorName = categoryDetector.properties.metadata.name;
        this.detectorDescription = categoryDetector.properties.metadata.description;
        this.clusterArmId = getClusterArmId(categoryDetector);
    }

    readonly detectorName: string;
    readonly detectorDescription: string;
    readonly clusterArmId: string;

    getTitle(): string {
        return `${this.detectorName} diagnostics for ${this.clusterName}`;
    }

    getInitialState(): InitialState {
        return {
            name: this.clusterName,
            description: this.detectorDescription,
            clusterArmId: this.clusterArmId,
            portalReferrerContext: meta.name,
            detectors: this.detectors,
        };
    }

    getMessageHandler(): MessageHandler<ToVsCodeMsgDef> {
        return {};
    }
}

function getClusterArmId(response: ARMResponse<unknown>): string {
    return response.id.split("detectors")[0];
}
