import { MessageDefinition, MessageHandler, MessageSource } from "../../../src/webview-contract/messaging";

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

    static create(name: string, factory: () => JSX.Element): Scenario {
        return new Scenario(name, factory);
    }

    withSubscription<TListenMsg extends MessageDefinition>(context: MessageSource<TListenMsg>, handler: MessageHandler<TListenMsg>): Scenario {
        const factory = () => {
            // Set up the subscription before creating the element
            context.subscribeToMessages(handler);
            return this.factory();
        };
        return new Scenario(this.name, factory);
    }
}
