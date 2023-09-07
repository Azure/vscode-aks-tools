/**
 * A type for defining a set of related messages (all messages going to or from a particular webview).
 * The keys are the command names, and the values are the types of the parameters.
 */
export type MessageDefinition = {
    [commandName: string]: any
};

/**
 * A component that messages can be sent to. Both Webviews and the
 * VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSink<TPostMsgDef extends MessageDefinition> {
    postMessage(message: Message<TPostMsgDef>): void
}

/**
 * A component that emits messages that can be subscribed to. Both
 * Webviews and the VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSource<TListenMsgDef extends MessageDefinition> {
    subscribeToMessages(handler: MessageHandler<TListenMsgDef>): void
}

/**
 * A type that represents one side of a two-way communication, i.e. it
 * can both send and receive messages. Both Webviews and the VS Code
 * extension can be instances of a `MessageContext`.
 */
export type MessageContext<TPostMsgDef extends MessageDefinition, TListenMsgDef extends MessageDefinition> = MessageSink<TPostMsgDef> & MessageSource<TListenMsgDef>;

/**
 * A discriminated union of the command names produced from the message definition `TMsgDef`.
 */
export type Command<T> = Extract<keyof T, string>;

/**
 * A discriminated union of the message types produced from the message definition `TMsgDef`.
 */
export type Message<TMsgDef extends MessageDefinition> = {
    [P in Command<TMsgDef>]: {
        command: P,
        parameters: TMsgDef[P]
    }
}[Command<TMsgDef>];

/**
 * The handler type for all the messages defined in `TMsgDef`.
 */
export type MessageHandler<TMsgDef extends MessageDefinition> = {
    [P in keyof TMsgDef]: (args: TMsgDef[P], command: P) => void
};

export function isValidMessage<TMsgDef extends MessageDefinition>(message: any): message is Message<TMsgDef> {
    return message && !!message.command;
}
