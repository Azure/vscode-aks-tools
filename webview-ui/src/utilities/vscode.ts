import type { WebviewApi } from "vscode-webview";
import { MessageDefinition, MessageHandler, isValidMessage } from "../../../src/webview-contract/messaging";
import { ContentId, ToVsCodeMessage, ToVsCodeMessageHandler, ToWebviewMessage, ToWebviewMessageHandler, VsCodeMessageContext, WebviewMessageContext } from "../../../src/webview-contract/webviewTypes";

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

class WebviewMessageContextImpl<T extends ContentId> implements WebviewMessageContext<T> {
    postMessage(message: ToVsCodeMessage<T>) {
        if (vsCodeApi) {
            vsCodeApi.postMessage(message);
        } else {
            console.log(`Dispatching ${JSON.stringify(message)} to '${interceptorEventTarget.name}'`);
            interceptorEventTarget.target.dispatchEvent(new MessageEvent('vscode-message', { data: message }));
        }
    }

    subscribeToMessages(handler: ToWebviewMessageHandler<T>) {
        windowEventListener = subscribeToMessages(windowEventTarget, windowEventListener, handler, 'message');
    }
}

/**
 * @returns the `MessageContext` used by the webviews, i.e. that post messages to the VS Code extension
 * and listen to messages from the VS Code extension.
 */
export function getWebviewMessageContext<T extends ContentId>(): WebviewMessageContext<T> {
    return new WebviewMessageContextImpl<T>();
}

class VscodeInterceptorMessageContext<T extends ContentId> implements VsCodeMessageContext<T> {
    postMessage(message: ToWebviewMessage<T>) {
        console.log(`Dispatching ${JSON.stringify(message)} to '${windowEventTarget.name}'`);
        windowEventTarget.target.dispatchEvent(new MessageEvent('message', { data: message }));
    }

    subscribeToMessages(handler: ToVsCodeMessageHandler<T>) {
        interceptorEventListener = subscribeToMessages(interceptorEventTarget, interceptorEventListener, handler, 'vscode-message');
    }
}

/**
 * @returns the `MessageContext` used in browser-based manual testing scenarios, in which the
 * React application code acts as the VS Code extension, intercepting messages from the Webview
 * and posting back its own messages.
 */
export function getTestVscodeMessageContext<T extends ContentId>(): VsCodeMessageContext<T> {
    return new VscodeInterceptorMessageContext<T>();
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
            action(message.parameters, message.command);
        } else {
            console.error(`No handler found for command ${message.command}`);
        }
    };

    console.log(`Adding listeners for [${commands.join(',')}] to '${eventTarget.name}'`);
    eventTarget.target.addEventListener(eventType, newListener);
    return { listener: newListener, commands };
}
