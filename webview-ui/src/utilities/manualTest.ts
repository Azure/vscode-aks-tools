import { CommandKeys, MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { ContentId, ToVsCodeMsgDef, ToWebviewMsgDef } from "../../../src/webview-contract/webviewTypes";
import { getTestVscodeMessageContext } from "./vscode";

/**
 * Represents scenarios for manual testing webviews in a browser.
 * 
 * The same Webview can be set up with different initial data or message handlers.
 */
export class Scenario {
    private constructor(
        readonly name: string,
        readonly factory: () => JSX.Element
    ) { }

    static create<T extends ContentId>(
        contentId: T,
        description: string,
        factory: () => JSX.Element,
        getHandler: (webview: MessageSink<ToWebviewMsgDef<T>>) => MessageHandler<ToVsCodeMsgDef<T>>,
        cmdKeys: CommandKeys<ToWebviewMsgDef<T>>
    ): Scenario {
        const name = description ? `${contentId} (${description})` : contentId;
        return new Scenario(name, () => {
            const context = getTestVscodeMessageContext<T>(cmdKeys);
            // Set up the subscription before creating the element
            context.subscribeToMessages(getHandler(context));
            return factory();
        });
    }
}
