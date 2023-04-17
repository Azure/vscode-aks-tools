/**
 * The type of any command that's passed between the VS Code extension
 * and a Webview.
 * 
 * For each Webview, the `command` property uniquely determines the
 * kind of message, and what handler will subscribe to it.
 */
export interface Command<TName extends string> { command: TName };

/**
 * A component that messages can be sent to. Both Webviews and the
 * VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSink<TPostMsg> {
    postMessage(message: TPostMsg): void
}

/**
 * A component that emits messages that can be subscribed to. Both
 * Webviews and the VS Code extension can act as `MessageSink` instances.
 */
export interface MessageSource<TListenMsg> {
    subscribeToMessages(subscriber: MessageSubscriber<TListenMsg>): void
}

/**
 * A type that represents one side of a two-way communication, i.e. it
 * can both send and receive messages. Both Webviews and the VS Code
 * extension can be instances of a `MessageContext`.
 */
export type MessageContext<TPostMsg, TListenMsg> = MessageSink<TPostMsg> & MessageSource<TListenMsg>;

type MessageHandlers<TMessage> = {
    [command: string]: (message: TMessage) => void
};

/**
 * A holder for all the handlers of a collection of commands.
 * 
 * `TMessage` is expected to be a union type containing all the command
 * types for a particular `MessageSource`.
 * 
 * It can be instantiated using `create()` and chaining `withHandler()`
 * methods for each command type.
 */
export class MessageSubscriber<TMessage> {
    private constructor(
        private readonly handlers: MessageHandlers<TMessage>
    ) { }

    static create<TMessage>(): MessageSubscriber<TMessage> {
        return new MessageSubscriber({});
    }

    getCommands() {
        return Object.keys(this.handlers);
    }

    getHandler(command: string): (message: TMessage) => void {
        const handler = this.handlers[command];
        if (!handler) {
            throw new Error(`No handler found for command ${command}`);
        }
        return handler;
    }

    withHandler<TCommand extends string>(command: TCommand, fn: (message: (Command<TCommand> & TMessage)) => void) {
        let newHandler: MessageHandlers<TMessage> = {};
        newHandler[command] = msg => fn(msg as Command<TCommand> & TMessage);
        const mergedHandlers = { ...this.handlers, ...newHandler };
        return new MessageSubscriber<TMessage>(mergedHandlers);
    }
}
