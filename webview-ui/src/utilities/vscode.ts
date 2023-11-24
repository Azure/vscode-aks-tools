import type { WebviewApi } from "vscode-webview";
import {
    asMessageSink,
    MessageDefinition,
    MessageHandler,
    isValidMessage,
    CommandKeys,
    PostMessageImpl,
    MessageSource,
} from "../../../src/webview-contract/messaging";
import {
    ContentId,
    ToVsCodeMsgDef,
    ToWebviewMsgDef,
    VsCodeMessageContext,
    WebviewMessageContext,
} from "../../../src/webview-contract/webviewTypes";
import { isObject } from "./runtimeTypes";

const vsCodeApi: WebviewApi<unknown> | undefined =
    typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

interface NamedEventTarget {
    target: EventTarget;
    name: string;
}

interface EventListenerWithCommands {
    listener: EventListener;
    commands: string[];
}

// There is only one EventTarget for intercepting vscode messages, and one for responding to them.
const windowEventTarget: NamedEventTarget = { target: window, name: "Webview window" };
const interceptorEventTarget: NamedEventTarget = { target: new EventTarget(), name: "VSCode message interceptor" };

let windowEventListener: EventListenerWithCommands | null = null;
let interceptorEventListener: EventListenerWithCommands | null = null;

/**
 * @returns the `MessageContext` used by the webviews, i.e. that post messages to the VS Code extension
 * and listen to messages from the VS Code extension.
 */
export function getWebviewMessageContext<T extends ContentId>(
    toVsCodeCmdKeys: CommandKeys<ToVsCodeMsgDef<T>>,
): WebviewMessageContext<T> {
    const postMessageImpl: PostMessageImpl<ToVsCodeMsgDef<T>> = (message) => {
        if (vsCodeApi) {
            vsCodeApi.postMessage(message);
        } else {
            console.log(`Dispatching ${JSON.stringify(message)} to '${interceptorEventTarget.name}'`);
            interceptorEventTarget.target.dispatchEvent(new MessageEvent("vscode-message", { data: message }));
        }
    };

    const sink = asMessageSink(postMessageImpl, toVsCodeCmdKeys);
    const source: MessageSource<ToWebviewMsgDef<T>> = {
        subscribeToMessages(handler) {
            windowEventListener = subscribeToMessages(windowEventTarget, windowEventListener, handler, "message");
        },
    };

    return { ...sink, ...source };
}

/**
 * @returns the `MessageContext` used in browser-based manual testing scenarios, in which the
 * React application code acts as the VS Code extension, intercepting messages from the Webview
 * and posting back its own messages.
 */
export function getTestVscodeMessageContext<T extends ContentId>(
    toWebviewCmdKeys: CommandKeys<ToWebviewMsgDef<T>>,
): VsCodeMessageContext<T> {
    const postMessageImpl: PostMessageImpl<ToWebviewMsgDef<T>> = (message) => {
        console.log(`Dispatching ${JSON.stringify(message)} to '${windowEventTarget.name}'`);
        windowEventTarget.target.dispatchEvent(new MessageEvent("message", { data: message }));
    };

    const sink = asMessageSink(postMessageImpl, toWebviewCmdKeys);
    const source: MessageSource<ToVsCodeMsgDef<T>> = {
        subscribeToMessages(handler) {
            interceptorEventListener = subscribeToMessages(
                interceptorEventTarget,
                interceptorEventListener,
                handler,
                "vscode-message",
            );
        },
    };

    return { ...sink, ...source };
}

function subscribeToMessages<TMsgDef extends MessageDefinition>(
    eventTarget: NamedEventTarget,
    currentEventListener: EventListenerWithCommands | null,
    handler: MessageHandler<TMsgDef>,
    eventType: string,
): EventListenerWithCommands {
    if (currentEventListener) {
        console.log(`Removing listeners for [${currentEventListener.commands.join(",")} from '${eventTarget.name}']`);
        eventTarget.target.removeEventListener(eventType, currentEventListener.listener);
    }

    const commands = Object.keys(handler);
    const newListener = (messageEvent: Event) => {
        const message = "data" in messageEvent && messageEvent.data;
        if (!isObject(message) || !isValidMessage<TMsgDef>(message)) {
            return;
        }

        console.log(
            `'${eventTarget.name}' is handling command '${message.command}' (able to handle [${commands.join(",")}])`,
        );
        const action = handler[message.command];
        if (action) {
            action(message.parameters, message.command);
        } else {
            console.error(`No handler found for command ${message.command}`);
        }
    };

    console.log(`Adding listeners for [${commands.join(",")}] to '${eventTarget.name}'`);
    eventTarget.target.addEventListener(eventType, newListener);
    return { listener: newListener, commands };
}
