import { Disposable, Webview, window, Uri, ViewColumn } from "vscode";
import {
    CommandKeys,
    Message,
    MessageDefinition,
    MessageHandler,
    MessageSource,
    PostMessageImpl,
    asMessageSink,
    isValidMessage,
} from "../webview-contract/messaging";
import { getNonce, getUri } from "./utilities/webview";
import { encodeState } from "../webview-contract/initialState";
import {
    ContentId,
    InitialState,
    TelemetryDefinition,
    ToVsCodeMessageHandler,
    ToVsCodeMsgDef,
    ToWebviewMessageSink,
    ToWebviewMsgDef,
    VsCodeMessageContext,
} from "../webview-contract/webviewTypes";
import { reporter } from "../commands/utils/reporter";

const viewType = "aksVsCodeTools";

/**
 * The type that handles data flow to and from a Webview Panel, namely:
 * - supplying it with initial data
 * - handling messages from the webview and posting messages back
 */
export interface PanelDataProvider<TContent extends ContentId> {
    getTitle(): string;
    getInitialState(): InitialState<TContent>;
    getTelemetryDefinition(): TelemetryDefinition<TContent>;
    getMessageHandler(webview: ToWebviewMessageSink<TContent>): ToVsCodeMessageHandler<TContent>;
}

/**
 * Common base class for VS Code Webview panels.
 */
export abstract class BasePanel<TContent extends ContentId> {
    protected constructor(
        readonly extensionUri: Uri,
        readonly contentId: TContent,
        readonly webviewCommandKeys: CommandKeys<ToWebviewMsgDef<TContent>>,
    ) {}

    show(dataProvider: PanelDataProvider<TContent>, ...disposables: Disposable[]) {
        const panelOptions = {
            enableScripts: true,
            // Restrict the webview to only load resources from the `webview-ui/dist` directory
            localResourceRoots: [Uri.joinPath(this.extensionUri, "webview-ui/dist")],
            // persist the state of the webview across restarts
            retainContextWhenHidden: true,
        };

        const title = dataProvider.getTitle();

        const panel = window.createWebviewPanel(viewType, title, ViewColumn.One, panelOptions);

        // Set up messaging between VSCode and the webview.
        const telemetryDefinition = dataProvider.getTelemetryDefinition();
        const messageContext = getMessageContext(
            panel.webview,
            this.webviewCommandKeys,
            this.contentId,
            telemetryDefinition,
            disposables,
        );
        const messageHandler = dataProvider.getMessageHandler(messageContext);
        messageContext.subscribeToMessages(messageHandler);

        // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
        // the panel or when the panel is closed programmatically)
        panel.onDidDispose(
            () => {
                panel.dispose();
                disposables.forEach((d) => d.dispose());
            },
            null,
            disposables,
        );

        // Set the HTML content for the webview panel
        const initialState = dataProvider.getInitialState();
        panel.webview.html = this.getWebviewContent(panel.webview, this.extensionUri, title, initialState);
    }

    private getWebviewContent(
        webview: Webview,
        extensionUri: Uri,
        title: string,
        initialState: InitialState<TContent> | undefined,
    ) {
        // Get URIs for the React build output.
        const stylesUri = getUri(webview, extensionUri, ["assets", "main.css"]);
        const scriptUri = getUri(webview, extensionUri, ["assets", "main.js"]);

        // See: https://github.com/microsoft/vscode-webview-ui-toolkit/blob/main/docs/getting-started.md#enable-webview-scripts-and-improve-security
        const nonce = getNonce();

        const encodedInitialState = encodeState(initialState);

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /* html*/ `
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

function getMessageContext<TContent extends ContentId>(
    webview: Webview,
    webviewCommandKeys: CommandKeys<ToWebviewMsgDef<TContent>>,
    contentId: TContent,
    telemetryDefinition: TelemetryDefinition<TContent>,
    disposables: Disposable[],
): VsCodeMessageContext<TContent> {
    const postMessageImpl: PostMessageImpl<ToWebviewMsgDef<TContent>> = (message) => webview.postMessage(message);
    const sink = asMessageSink(postMessageImpl, webviewCommandKeys);
    const source: MessageSource<ToVsCodeMsgDef<TContent>> = {
        subscribeToMessages: (handler) => {
            webview.onDidReceiveMessage(
                (message: object) => {
                    if (!isValidMessage<ToVsCodeMsgDef<TContent>>(message)) {
                        throw new Error(`Invalid message to VsCode: ${JSON.stringify(message)}`);
                    }

                    const telemetryData = getTelemetryData(contentId, telemetryDefinition, message);
                    if (telemetryData !== null) {
                        reporter.sendTelemetryEvent("command", telemetryData);
                    }

                    const action = (handler as MessageHandler<MessageDefinition>)[message.command];
                    if (action) {
                        action(message.parameters, message.command);
                    } else {
                        window.showErrorMessage(`No handler found for command ${message.command}`);
                    }
                },
                undefined,
                disposables,
            );
        },
    };

    return { ...sink, ...source };
}

function getTelemetryData<TContent extends ContentId>(
    contentId: TContent,
    telemetryDefinition: TelemetryDefinition<TContent>,
    message: Message<ToVsCodeMsgDef<TContent>>,
): { [key: string]: string } | null {
    const getTelemetryData = telemetryDefinition[message.command];

    // getTelemetryData is either `true` or a function returning a properties object.
    if (getTelemetryData === false) return null;

    // The `command` value we emit will combine the webview identifier (contentId), e.g. `createCluster`
    // with either:
    // - the command in the message, e.g. `createClusterRequest`
    // - the return value of `getTelemetryData`
    const commandValue = getTelemetryData === true ? message.command : getTelemetryData(message.parameters);
    return { command: `${contentId}.${commandValue}` };
}
