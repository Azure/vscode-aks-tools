import { Message, MessageContext, MessageDefinition, MessageHandler } from "./messaging";
import { DetectorDefinition } from "./webviewDefinitions/detector";
import { PeriscopeDefinition } from "./webviewDefinitions/periscope";
import { TestStyleViewerDefinition } from "./webviewDefinitions/testStyleViewer";

export type WebviewDefinition<TInitialState extends object, TToVsCode extends MessageDefinition, TToWebview extends MessageDefinition> = {
    initialState: TInitialState,
    toVsCodeMsgDef: TToVsCode,
    toWebviewMsgDef: TToWebview
};

type AllWebviewDefinitions = {
    style: TestStyleViewerDefinition,
    periscope: PeriscopeDefinition,
    detector: DetectorDefinition
};

type ContentIdLookup = {
    [id in keyof AllWebviewDefinitions]: id
};

export type ContentId = ContentIdLookup[keyof ContentIdLookup];

export type InitialState<T extends ContentId> = AllWebviewDefinitions[T]["initialState"];
export type ToVsCodeMsgDef<T extends ContentId> = AllWebviewDefinitions[T]["toVsCodeMsgDef"];
export type ToWebviewMsgDef<T extends ContentId> = AllWebviewDefinitions[T]["toWebviewMsgDef"];

export type ToVsCodeMessageHandler<T extends ContentId> = MessageHandler<ToVsCodeMsgDef<T>>;
export type ToWebviewMessageHandler<T extends ContentId> = MessageHandler<ToWebviewMsgDef<T>>;

export type ToVsCodeMessage<T extends ContentId> = Message<ToVsCodeMsgDef<T>>;
export type ToWebviewMessage<T extends ContentId> = Message<ToWebviewMsgDef<T>>;

export type VsCodeMessageContext<T extends ContentId> = MessageContext<ToWebviewMsgDef<T>, ToVsCodeMsgDef<T>>;
export type WebviewMessageContext<T extends ContentId> = MessageContext<ToVsCodeMsgDef<T>, ToWebviewMsgDef<T>>;
