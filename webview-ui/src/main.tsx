import { StrictMode } from "react";
import ReactDOM from "react-dom";
import './main.css';
import * as ContractTypes from "../../src/webview-contract/webviewTypes";
import { TestStyleViewer } from "./TestStyleViewer/TestStyleViewer";
import { Periscope } from "./Periscope/Periscope";

// There are two modes of launching this application:
// 1. Via the VS Code extension inside a Webview.
// 2. In a browser using a local web server.
//
// This entrypoint is for the VS Code extension:
// - Content selection: the extension will specify the content using a 'data-contentid' attribute on the root element.
// - Initial state: the extension will specify initial state as a JSON-serialized value in the 'data-initialstate'
//   attribute on the root element.
// - Message passing: the extension will handle outgoing messages from React components (sent using `vscode.postMessage`)
//   and will respond using `Webview.postMessage`.

const rootElem = document.getElementById("root");

function getVsCodeContent(): JSX.Element {
    if (!rootElem) {
        return <>Error: Element with ID 'root' is not found.</>;
    }
    const vscodeContentId = rootElem?.dataset.contentid;
    if (!vscodeContentId) {
        return <>Error: 'content-id' attribute is not set on root element.</>;
    }

    const vsCodeInitialState = JSON.parse(rootElem?.dataset.initialstate || "{}");
    switch (vscodeContentId) {
        case ContractTypes.TestStyleViewerTypes.contentId: return <TestStyleViewer {...vsCodeInitialState} />
        case ContractTypes.PeriscopeTypes.contentId: return <Periscope {...vsCodeInitialState} />
        default: return <>`Error: Unexpected content ID: '${vscodeContentId}'`</>;
    }
}

ReactDOM.render(
    <StrictMode>
        {getVsCodeContent()}
    </StrictMode>,
    rootElem
);
