import type { WebviewApi } from "vscode-webview";
import { MessageContext, MessageSubscriber } from "../../../src/webview-contract/messaging";

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

class WebviewMessageContext<TToVsCodeCommands, TToWebviewCommands> implements MessageContext<TToVsCodeCommands, TToWebviewCommands> {
    postMessage(message: TToVsCodeCommands) {
        if (vsCodeApi) {
            vsCodeApi.postMessage(message);
        } else {
            console.log(`Dispatching ${JSON.stringify(message)} to '${interceptorEventTarget.name}'`);
            interceptorEventTarget.target.dispatchEvent(new MessageEvent('vscode-message', { data: message }));
        }
    }

    subscribeToMessages(subscriber: MessageSubscriber<TToWebviewCommands>) {
        windowEventListener = subscribeToMessages(windowEventTarget, windowEventListener, subscriber, 'message');
    }
}

/**
 * @returns the `MessageContext` used by the webviews, i.e. that post messages to the VS Code extension
 * and listen to messages from the VS Code extension.
 */
export function getWebviewMessageContext<TToVsCodeCommands, TToWebviewCommands>(): MessageContext<TToVsCodeCommands, TToWebviewCommands> {
    return new WebviewMessageContext<TToVsCodeCommands, TToWebviewCommands>();
}

class VscodeInterceptorMessageContext<TToWebviewCommands, TToVsCodeCommands> implements MessageContext<TToWebviewCommands, TToVsCodeCommands> {
    postMessage(message: TToWebviewCommands) {
        console.log(`Dispatching ${JSON.stringify(message)} to '${windowEventTarget.name}'`);
        windowEventTarget.target.dispatchEvent(new MessageEvent('message', { data: message }));
    }

    subscribeToMessages(subscriber: MessageSubscriber<TToVsCodeCommands>) {
        interceptorEventListener = subscribeToMessages(interceptorEventTarget, interceptorEventListener, subscriber, 'vscode-message');
    }
}

/**
 * @returns the `MessageContext` used in browser-based manual testing scenarios, in which the
 * React application code acts as the VS Code extension, intercepting messages from the Webview
 * and posting back its own messages.
 */
export function getTestVscodeMessageContext<TToWebviewCommands, TToVsCodeCommands>(): MessageContext<TToWebviewCommands, TToVsCodeCommands> {
    return new VscodeInterceptorMessageContext<TToWebviewCommands, TToVsCodeCommands>();
}

function subscribeToMessages<TMessage>(
    eventTarget: NamedEventTarget,
    currentEventListener: EventListenerWithCommands | null,
    subscriber: MessageSubscriber<TMessage>,
    eventType: string
): EventListenerWithCommands {
    if (currentEventListener) {
        console.log(`Removing listeners for [${currentEventListener.commands.join(',')} from '${eventTarget.name}']`);
        eventTarget.target.removeEventListener(eventType, currentEventListener.listener);
    }

    const commands = subscriber.getCommands();
    const newListener = (message: any) => {
        const command = message.data.command;
        if (!command) {
            return;
        }

        console.log(`'${eventTarget.name}' is handling command '${command}' (able to handle [${commands.join(',')}])`);
        const handler = subscriber.getHandler(command);
        handler(message.data);
    };

    console.log(`Adding listeners for [${commands.join(',')}] to '${eventTarget.name}'`);
    eventTarget.target.addEventListener(eventType, newListener);
    return { listener: newListener, commands };
}
