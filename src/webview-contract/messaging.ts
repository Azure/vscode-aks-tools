/**
 * A component that messages can be sent to. Both Webviews and the
 * VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSink<TPostMsgDef> {
    postMessage(message: Message<TPostMsgDef>): void
}

/**
 * A component that emits messages that can be subscribed to. Both
 * Webviews and the VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSource<TListenMsgDef> {
    subscribeToMessages(handler: MessageHandler<TListenMsgDef>): void
}

/**
 * A type that represents one side of a two-way communication, i.e. it
 * can both send and receive messages. Both Webviews and the VS Code
 * extension can be instances of a `MessageContext`.
 */
export type MessageContext<TPostMsgDef, TListenMsgDef> = MessageSink<TPostMsgDef> & MessageSource<TListenMsgDef>;

// Shortcut type for creating mapped types using only the `string` keys of object types.
type StringProperties<T> = Extract<keyof T, string>;

/**
 * A discriminated union of the message types produced from the message definition `TMsgDef`.
 */
export type Message<TMsgDef> = {[P in StringProperties<TMsgDef>]: {command: P, parameters: TMsgDef[P]}}[StringProperties<TMsgDef>];

/**
 * The handler type for all the messages defined in `TMsgDef`.
 */
export type MessageHandler<TMsgDef> = {[P in StringProperties<TMsgDef>]: (args: TMsgDef[P]) => void};

export function isValidMessage<TMsgDef>(message: any): message is Message<TMsgDef> {
    return message && !!message.command;
}
