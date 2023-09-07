import { Disposable, Webview, window, Uri, ViewColumn } from "vscode";
import { Message, MessageContext, MessageDefinition, MessageHandler, MessageSink, isValidMessage } from "../webview-contract/messaging";
import { getNonce, getUri } from "./utilities/webview";
import { encodeState } from "../webview-contract/initialState";

const viewType = "aksVsCodeTools";

/**
 * The type that handles data flow to and from a Webview Panel, namely:
 * - supplying it with initial data
 * - handling messages from the webview and posting messages back
 */
export interface PanelDataProvider<TInitialState, TToWebview extends MessageDefinition, TToVsCode extends MessageDefinition> {
    getTitle(): string
    getInitialState(): TInitialState
    getMessageHandler(webview: MessageSink<TToWebview>): MessageHandler<TToVsCode>
}

/**
 * Common base class for VS Code Webview panels.
 * 
 * The generic types are:
 * - TInitialState: The initial state object (passed as `props` to the corresponding React component),
 *   or `void` if not required.
 * - TToWebview: A definition of the `Command` types that will be posted to the Webview.
 * - TToVsCode: A definition of the `Command` types that the extension will listen for from the Webview.
 */
export abstract class BasePanel<TInitialState, TToWebview extends MessageDefinition, TToVsCode extends MessageDefinition> {
    protected constructor(
        readonly extensionUri: Uri,
        readonly contentId: string
    ) { }

    show(dataProvider: PanelDataProvider<TInitialState, TToWebview, TToVsCode>, ...disposables: Disposable[]) {
        const panelOptions = {
            enableScripts: true,
            // Restrict the webview to only load resources from the `webview-ui/dist` directory
            localResourceRoots: [Uri.joinPath(this.extensionUri, "webview-ui/dist")],
        };

        const title = dataProvider.getTitle();

        const panel = window.createWebviewPanel(viewType, title, ViewColumn.One, panelOptions);

        // Set up messaging between VSCode and the webview.
        const messageContext = new WebviewMessageContext<TToWebview, TToVsCode>(panel.webview, disposables);
        const messageHandler = dataProvider.getMessageHandler(messageContext);
        messageContext.subscribeToMessages(messageHandler);

        // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
        // the panel or when the panel is closed programmatically)
        panel.onDidDispose(() => {
            panel.dispose();
            disposables.forEach(d => d.dispose());
        }, null, disposables);

        // Set the HTML content for the webview panel
        const initialState = dataProvider.getInitialState();
        panel.webview.html = this._getWebviewContent(panel.webview, this.extensionUri, title, initialState);
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri, title: string, initialState: TInitialState | undefined) {
        // Get URIs for the React build output.
        const stylesUri = getUri(webview, extensionUri, ["assets", "main.css"]);
        const scriptUri = getUri(webview, extensionUri, ["assets", "main.js"]);

        // See: https://github.com/microsoft/vscode-webview-ui-toolkit/blob/main/docs/getting-started.md#enable-webview-scripts-and-improve-security
        const nonce = getNonce();

        const encodedInitialState = encodeState(initialState);

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src 'self'">
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <title>${title}</title>
            </head>
            <body>
                <div id="root" data-contentid="${this.contentId}" data-initialstate="${encodedInitialState}"></div>
                <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
        </html>
    `;
    }
}

/**
 * A `MessageContext` that represents the Webview.
 */
class WebviewMessageContext<TToWebview extends MessageDefinition, TToVsCode extends MessageDefinition> implements MessageContext<TToWebview, TToVsCode> {
    constructor(
        private readonly _webview: Webview,
        private readonly _disposables: Disposable[]
    ) { }

    postMessage(message: Message<TToWebview>) {
        this._webview.postMessage(message);
    }

    subscribeToMessages(handler: MessageHandler<TToVsCode>) {
        this._webview.onDidReceiveMessage(
            (message: any) => {
                if (!isValidMessage<TToVsCode>(message)) {
                    throw new Error(`Invalid message to VsCode: ${JSON.stringify(message)}`);
                }

                const action = handler[message.command];
                if (action) {
                    action(message.parameters);
                } else {
                    window.showErrorMessage(`No handler found for command ${message.command}`);
                }
            },
            undefined,
            this._disposables
        );
    }
}
