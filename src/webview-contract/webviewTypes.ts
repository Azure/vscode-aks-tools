import { Message, MessageContext, MessageDefinition, MessageHandler, MessageSink } from "./messaging";
import { ClusterPropertiesDefinition } from "./webviewDefinitions/clusterProperties";
import { CreateClusterDefinition } from "./webviewDefinitions/createCluster";
import { DetectorDefinition } from "./webviewDefinitions/detector";
import { KubectlDefinition } from "./webviewDefinitions/kubectl";
import { InspektorGadgetDefinition } from "./webviewDefinitions/inspektorGadget";
import { PeriscopeDefinition } from "./webviewDefinitions/periscope";
import { TestStyleViewerDefinition } from "./webviewDefinitions/testStyleViewer";
import { ASODefinition } from "./webviewDefinitions/azureServiceOperator";

/**
 * Groups all the related types for a single webview.
 */
export type WebviewDefinition<TInitialState extends object, TToVsCode extends MessageDefinition, TToWebview extends MessageDefinition> = {
    initialState: TInitialState,
    toVsCodeMsgDef: TToVsCode,
    toWebviewMsgDef: TToWebview
};

/**
 * Defines all the types for all the Webviews. All content IDs and common types for all webviews
 * are defined here.
 */
type AllWebviewDefinitions = {
    style: TestStyleViewerDefinition,
    clusterProperties: ClusterPropertiesDefinition,
    periscope: PeriscopeDefinition,
    createCluster: CreateClusterDefinition,
    detector: DetectorDefinition,
    gadget: InspektorGadgetDefinition,
    kubectl: KubectlDefinition,
    aso: ASODefinition
};

type ContentIdLookup = {
    [id in keyof AllWebviewDefinitions]: id
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
