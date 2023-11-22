/**
 * A type for defining a set of related messages (all messages going to or from a particular webview).
 * The keys are the command names, and the values are the types of the parameters.
 */
export type MessageDefinition = {
    [commandName: string]: unknown;
};

/**
 * Any object containing all the keys (commands) for a message definition.
 */
export type CommandKeys<TMsgDef> = {
    [P in Command<TMsgDef>]: unknown;
};

/**
 * A component that messages can be sent to. Both Webviews and the
 * VS Code extension can act as `MessageSink` instances.
 */
export type MessageSink<TMsgDef extends MessageDefinition> = {
    [P in Command<TMsgDef> as `post${Capitalize<P>}`]: (args: TMsgDef[P]) => void;
};

export type PostMessageImpl<TPostMsgDef extends MessageDefinition> = (message: Message<TPostMsgDef>) => void;

export function asMessageSink<TPostMsgDef extends MessageDefinition>(
    postImpl: PostMessageImpl<TPostMsgDef>,
    keys: CommandKeys<TPostMsgDef>,
): MessageSink<TPostMsgDef> {
    const entries = Object.keys(keys).map((command) => [
        asPostFunction(command),
        (parameters: unknown) => postImpl({ command, parameters } as Message<TPostMsgDef>),
    ]);
    return Object.fromEntries(entries);
}

function asPostFunction(str: string) {
    return `post${str[0].toUpperCase()}${str.slice(1)}`;
}

/**
 * A component that emits messages that can be subscribed to. Both
 * Webviews and the VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSource<TListenMsgDef extends MessageDefinition> {
    subscribeToMessages(handler: MessageHandler<TListenMsgDef>): void;
}

/**
 * A type that represents one side of a two-way communication, i.e. it
 * can both send and receive messages. Both Webviews and the VS Code
 * extension can be instances of a `MessageContext`.
 */
export type MessageContext<
    TPostMsgDef extends MessageDefinition,
    TListenMsgDef extends MessageDefinition,
> = MessageSink<TPostMsgDef> & MessageSource<TListenMsgDef>;

/**
 * A discriminated union of the command names produced from the message definition `TMsgDef`.
 */
export type Command<T> = Extract<keyof T, string>;

/**
 * A discriminated union of the message types produced from the message definition `TMsgDef`.
 */
export type Message<TMsgDef extends MessageDefinition> = {
    [P in Command<TMsgDef>]: {
        command: P;
        parameters: TMsgDef[P];
    };
}[Command<TMsgDef>];

/**
 * The handler type for all the messages defined in `TMsgDef`.
 */
export type MessageHandler<TMsgDef extends MessageDefinition> = {
    [P in keyof TMsgDef]: (args: TMsgDef[P], command: P) => void;
};

export function isValidMessage<TMsgDef extends MessageDefinition>(message: object): message is Message<TMsgDef> {
    return message && "command" in message && !!message.command;
}
