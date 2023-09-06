import type { WebviewApi } from "vscode-webview";
import { Message, MessageContext, MessageDefinition, MessageHandler, isValidMessage } from "../../../src/webview-contract/messaging";

const vsCodeApi: WebviewApi<unknown> | undefined = (typeof acquireVsCodeApi === "function") ? acquireVsCodeApi() : undefined;

interface NamedEventTarget {
    target: EventTarget
    name: string
}

interface EventListenerWithCommands {
    listener: EventListener
    commands: string[]
}

// There is only one EventTarget for intercepting vscode messages, and one for responding to them.
const windowEventTarget: NamedEventTarget = { target: window, name: "Webview window" };
const interceptorEventTarget: NamedEventTarget = { target: new EventTarget(), name: "VSCode message interceptor" };

let windowEventListener: EventListenerWithCommands | null = null;
let interceptorEventListener: EventListenerWithCommands | null = null;

class WebviewMessageContext<TToVsCode extends MessageDefinition, TToWebview extends MessageDefinition> implements MessageContext<TToVsCode, TToWebview> {
    postMessage(message: Message<TToVsCode>) {
        if (vsCodeApi) {
            vsCodeApi.postMessage(message);
        } else {
            console.log(`Dispatching ${JSON.stringify(message)} to '${interceptorEventTarget.name}'`);
            interceptorEventTarget.target.dispatchEvent(new MessageEvent('vscode-message', { data: message }));
        }
    }

    subscribeToMessages(handler: MessageHandler<TToWebview>) {
        windowEventListener = subscribeToMessages(windowEventTarget, windowEventListener, handler, 'message');
    }
}

/**
 * @returns the `MessageContext` used by the webviews, i.e. that post messages to the VS Code extension
 * and listen to messages from the VS Code extension.
 */
export function getWebviewMessageContext<TToVsCode extends MessageDefinition, TToWebview extends MessageDefinition>(): MessageContext<TToVsCode, TToWebview> {
    return new WebviewMessageContext<TToVsCode, TToWebview>();
}

class VscodeInterceptorMessageContext<TToWebview extends MessageDefinition, TToVsCode extends MessageDefinition> implements MessageContext<TToWebview, TToVsCode> {
    postMessage(message: Message<TToWebview>) {
        console.log(`Dispatching ${JSON.stringify(message)} to '${windowEventTarget.name}'`);
        windowEventTarget.target.dispatchEvent(new MessageEvent('message', { data: message }));
    }

    subscribeToMessages(handler: MessageHandler<TToVsCode>) {
        interceptorEventListener = subscribeToMessages(interceptorEventTarget, interceptorEventListener, handler, 'vscode-message');
    }
}

/**
 * @returns the `MessageContext` used in browser-based manual testing scenarios, in which the
 * React application code acts as the VS Code extension, intercepting messages from the Webview
 * and posting back its own messages.
 */
export function getTestVscodeMessageContext<TToWebview extends MessageDefinition, TToVsCode extends MessageDefinition>(): MessageContext<TToWebview, TToVsCode> {
    return new VscodeInterceptorMessageContext<TToWebview, TToVsCode>();
}

function subscribeToMessages<TMsgDef extends MessageDefinition>(
    eventTarget: NamedEventTarget,
    currentEventListener: EventListenerWithCommands | null,
    handler: MessageHandler<TMsgDef>,
    eventType: string
): EventListenerWithCommands {
    if (currentEventListener) {
        console.log(`Removing listeners for [${currentEventListener.commands.join(',')} from '${eventTarget.name}']`);
        eventTarget.target.removeEventListener(eventType, currentEventListener.listener);
    }

    const commands = Object.keys(handler);
    const newListener = (messageEvent: any) => {
        const message = messageEvent.data;
        if (!isValidMessage<TMsgDef>(message)) {
            return;
        }

        console.log(`'${eventTarget.name}' is handling command '${message.command}' (able to handle [${commands.join(',')}])`);
        const action = handler[message.command];
        if (action) {
            action(message.parameters);
        } else {
            console.error(`No handler found for command ${message.command}`);
        }
    };

    console.log(`Adding listeners for [${commands.join(',')}] to '${eventTarget.name}'`);
    eventTarget.target.addEventListener(eventType, newListener);
    return { listener: newListener, commands };
}
