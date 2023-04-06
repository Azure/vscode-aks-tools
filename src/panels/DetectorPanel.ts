import { Uri } from "vscode";
import { MessageSink, MessageSubscriber } from "../webview-contract/messaging";
import { DetectorTypes } from "../webview-contract/webviewTypes";
import { BasePanel, PanelDataProvider } from "./BasePanel";
const meta = require('../../package.json');

export class DetectorPanel extends BasePanel<DetectorTypes.InitialState, never, never> {
    constructor(extensionUri: Uri) {
        super(extensionUri, DetectorTypes.contentId);
    }
}

export class DetectorDataProvider implements PanelDataProvider<DetectorTypes.InitialState, never, never> {
    public constructor(
        readonly clusterName: string,
        readonly categoryDetector: DetectorTypes.CategoryDetectorARMResponse,
        readonly detectors: DetectorTypes.SingleDetectorARMResponse[]
    ) {
        this.detectorName = categoryDetector.properties.metadata.name;
        this.detectorDescription = categoryDetector.properties.metadata.description;
        this.clusterArmId = getClusterArmId(categoryDetector);
    }

    readonly detectorName: string
    readonly detectorDescription: string
    readonly clusterArmId: string

    getTitle(): string {
        return `${this.detectorName} diagnostics for ${this.clusterName}`;
    }

    getInitialState(): DetectorTypes.InitialState {
        return {
            name: this.clusterName,
            description: this.detectorDescription,
            clusterArmId: this.clusterArmId,
            portalReferrerContext: meta.name,
            detectors: this.detectors
        };
    }

    createSubscriber(_webview: MessageSink<never>): MessageSubscriber<never> | null {
        return null;
    }
}

function getClusterArmId(response: DetectorTypes.ARMResponse<any>): string {
    return response.id.split('detectors')[0];
}