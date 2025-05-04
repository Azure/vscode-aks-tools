import { Message, MessageContext, MessageDefinition, MessageHandler, MessageSink } from "./messaging";
import { AttachAcrToClusterDefinition } from "./webviewDefinitions/attachAcrToCluster";
import { ASODefinition } from "./webviewDefinitions/azureServiceOperator";
import { ClusterPropertiesDefinition } from "./webviewDefinitions/clusterProperties";
import { CreateClusterDefinition } from "./webviewDefinitions/createCluster";
import { DetectorDefinition } from "./webviewDefinitions/detector";
import { DraftDeploymentDefinition } from "./webviewDefinitions/draft/draftDeployment";
import { DraftDockerfileDefinition } from "./webviewDefinitions/draft/draftDockerfile";
import { DraftWorkflowDefinition } from "./webviewDefinitions/draft/draftWorkflow";
import { DraftValidateDefinition } from "./webviewDefinitions/draft/draftValidate";
import { InspektorGadgetDefinition } from "./webviewDefinitions/inspektorGadget";
import { KaitoDefinition } from "./webviewDefinitions/kaito";
import { KaitoModelsDefinition } from "./webviewDefinitions/kaitoModels";
import { KaitoManageDefinition } from "./webviewDefinitions/kaitoManage";
import { KaitoTestDefinition } from "./webviewDefinitions/kaitoTest";
import { KubectlDefinition } from "./webviewDefinitions/kubectl";
import { PeriscopeDefinition } from "./webviewDefinitions/periscope";
import { RetinaCaptureDefinition } from "./webviewDefinitions/retinaCapture";
import { TCPDumpDefinition } from "./webviewDefinitions/tcpDump";
import { TestStyleViewerDefinition } from "./webviewDefinitions/testStyleViewer";
import { AutomatedDeploymentsDefinition } from "./webviewDefinitions/automatedDeployments";
import { CreateFleetDefinition } from "./webviewDefinitions/createFleet";
import { FleetProperties } from "./webviewDefinitions/fleetProperties";
import { HeadlampDefinition } from "./webviewDefinitions/headlamp";

/**
 * Groups all the related types for a single webview.
 */
export type WebviewDefinition<
    TInitialState extends object,
    TToVsCode extends MessageDefinition,
    TToWebview extends MessageDefinition,
> = {
    initialState: TInitialState;
    toVsCodeMsgDef: TToVsCode;
    toWebviewMsgDef: TToWebview;
};

/**
 * Defines all the types for all the Webviews. All content IDs and common types for all webviews
 * are defined here.
 */
type AllWebviewDefinitions = {
    style: TestStyleViewerDefinition;
    clusterProperties: ClusterPropertiesDefinition;
    attachAcrToCluster: AttachAcrToClusterDefinition;
    periscope: PeriscopeDefinition;
    createCluster: CreateClusterDefinition;
    detector: DetectorDefinition;
    draftDeployment: DraftDeploymentDefinition;
    draftDockerfile: DraftDockerfileDefinition;
    draftWorkflow: DraftWorkflowDefinition;
    draftValidate: DraftValidateDefinition;
    gadget: InspektorGadgetDefinition;
    kubectl: KubectlDefinition;
    aso: ASODefinition;
    tcpDump: TCPDumpDefinition;
    retinaCapture: RetinaCaptureDefinition;
    kaito: KaitoDefinition;
    kaitoModels: KaitoModelsDefinition;
    kaitoManage: KaitoManageDefinition;
    kaitoTest: KaitoTestDefinition;
    automatedDeployments: AutomatedDeploymentsDefinition;
    createFleet: CreateFleetDefinition;
    fleetProperties: FleetProperties;
    headlamp: HeadlampDefinition;
};

type ContentIdLookup = {
    [id in keyof AllWebviewDefinitions]: id;
};

/**
 * A union of all possible content ID values (the identifier for each Webview).
 */
export type ContentId = ContentIdLookup[keyof ContentIdLookup];

// Shortcuts for types for each webview...
export type InitialState<T extends ContentId> = AllWebviewDefinitions[T]["initialState"];
export type ToVsCodeMsgDef<T extends ContentId> = AllWebviewDefinitions[T]["toVsCodeMsgDef"];
export type ToWebviewMsgDef<T extends ContentId> = AllWebviewDefinitions[T]["toWebviewMsgDef"];

export type ToVsCodeMessageHandler<T extends ContentId> = MessageHandler<ToVsCodeMsgDef<T>>;
export type ToWebviewMessageHandler<T extends ContentId> = MessageHandler<ToWebviewMsgDef<T>>;

export type ToVsCodeMessageSink<T extends ContentId> = MessageSink<ToVsCodeMsgDef<T>>;
export type ToWebviewMessageSink<T extends ContentId> = MessageSink<ToWebviewMsgDef<T>>;

export type ToVsCodeMessage<T extends ContentId> = Message<ToVsCodeMsgDef<T>>;
export type ToWebviewMessage<T extends ContentId> = Message<ToWebviewMsgDef<T>>;

export type VsCodeMessageContext<T extends ContentId> = MessageContext<ToWebviewMsgDef<T>, ToVsCodeMsgDef<T>>;
export type WebviewMessageContext<T extends ContentId> = MessageContext<ToVsCodeMsgDef<T>, ToWebviewMsgDef<T>>;

/**
 * A type for definining what telemetry (if any) will be emitted for each message passed from a webview to VS Code.
 * Possible values are:
 * - false: No telemetry will be emitted
 * - true: A telemetry event will be emitted containing the property "command" with value "<webview>.<messagetype>"
 * - (args) => string: A telemetry event will be emitted containing the property "command" with value "<webview>.<returnValue>"
 *                     where `returnValue` is the command name returned from the specified function.
 */
export type TelemetryDefinition<T extends ContentId> = {
    [P in keyof ToVsCodeMsgDef<T>]: ((args: ToVsCodeMsgDef<T>[P]) => string) | boolean;
};
